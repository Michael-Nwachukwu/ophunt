import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createClient } from '@libsql/client';
import { createHmac, createHash, randomBytes } from 'crypto';
import fs, { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { analyzeContent, persistIdea, formatIdea } from './analyze.js';
import { agentStatus, discoverServices } from './argens.js';
import { startFeedScheduler, runFeedOnce } from './feed/worker.js';
import type { InValue } from '@libsql/client';

// Keep the process alive and log rather than crash on unexpected errors
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const app = express();

// Env-driven extra origins (comma-separated); always allow localhost in dev
const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);
const ALLOWED_ORIGINS = new Set([
  'http://localhost:8080',
  'http://localhost:5173',
  ...extraOrigins,
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    callback(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
}));

// ─── LemonSqueezy webhook — MUST be registered before express.json() ──────────
app.post('/api/webhooks/lemonsqueezy', express.raw({ type: '*/*' }), async (req, res) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || 'ophunt';
  const signature = req.headers['x-signature'] as string;
  const rawBody = req.body as Buffer;

  console.log('[LS webhook] Raw body preview:', rawBody?.toString('utf8')?.slice(0, 100));

  if (!signature) {
    console.warn('[LS webhook] Missing x-signature header — rejecting');
    return res.status(400).json({ error: 'Missing x-signature header' });
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signature !== expected) {
    console.warn('[LS webhook] Signature mismatch — rejecting');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const meta = payload.meta as Record<string, unknown> | undefined;
  const eventName = meta?.event_name as string | undefined;
  console.log('[LS webhook] Event received:', eventName);

  if (eventName === 'order_created') {
    const customData = meta?.custom_data as Record<string, unknown> | undefined;
    const ideaId = customData?.idea_id as string | undefined;
    const userId = customData?.user_id as string | undefined;
    const orderRef = ((payload.data as Record<string, unknown>)?.id as string) || '';
    const totalCents = (((payload.data as Record<string, unknown>)?.attributes as Record<string, unknown>)?.total as number) || 100;
    if (ideaId) {
      try {
        await db.execute({ sql: 'UPDATE ideas SET is_unlocked = 1 WHERE id = ?', args: [ideaId] });
        await db.execute({
          sql: `INSERT OR IGNORE INTO purchases (id, user_id, idea_id, amount_usd, payment_method, payment_ref)
                VALUES (?, ?, ?, ?, 'lemonsqueezy', ?)`,
          args: [randomUUID(), userId || null, ideaId, totalCents / 100, orderRef],
        });
        console.log('[LS webhook] Unlocked idea:', ideaId, 'user:', userId || 'anonymous');
      } catch (err) {
        console.error('[LS webhook] DB update failed:', err);
        return res.status(500).json({ error: 'DB update failed' });
      }
    } else {
      console.warn('[LS webhook] order_created received but no idea_id in meta.custom_data');
    }
  }

  return res.status(200).json({ received: true });
});

// Bypass route for manual testing — skips signature check
app.post('/api/webhooks/lemonsqueezy/bypass', express.json(), async (req, res) => {
  console.warn('[LS webhook BYPASS] Manual unlock triggered — do NOT use in production');
  const { idea_id } = req.body as { idea_id?: string };
  if (!idea_id) return res.status(400).json({ error: 'idea_id is required' });
  try {
    const check = await db.execute({ sql: 'SELECT id FROM ideas WHERE id = ?', args: [idea_id] });
    if (!check.rows[0]) return res.status(404).json({ error: 'Idea not found' });
    await db.execute({ sql: 'UPDATE ideas SET is_unlocked = 1 WHERE id = ?', args: [idea_id] });
    res.json({ ok: true, idea_id, message: 'Idea unlocked via bypass' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Paystack webhook — MUST be registered before express.json() ──────────────
app.post('/api/webhooks/paystack', express.raw({ type: '*/*' }), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY || '';
  const signature = req.headers['x-paystack-signature'] as string;
  const rawBody = req.body as Buffer;

  if (!signature || !secret) {
    console.warn('[Paystack webhook] Missing signature or secret key — rejecting');
    return res.status(400).json({ error: 'Missing signature or PAYSTACK_SECRET_KEY' });
  }

  const { createHmac: hmac } = await import('crypto');
  const expected = hmac('sha512', secret).update(rawBody).digest('hex');
  if (signature !== expected) {
    console.warn('[Paystack webhook] Signature mismatch — rejecting');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const event = payload.event as string | undefined;
  console.log('[Paystack webhook] Event received:', event);

  if (event === 'charge.success') {
    const data = payload.data as Record<string, unknown> | undefined;
    const metadata = data?.metadata as Record<string, unknown> | undefined;
    const ideaId = metadata?.idea_id as string | undefined;
    const userId = metadata?.user_id as string | undefined;
    const reference = data?.reference as string || '';
    const amountKobo = Number(data?.amount) || 100;

    if (ideaId) {
      try {
        await db.execute({ sql: 'UPDATE ideas SET is_unlocked = 1 WHERE id = ?', args: [ideaId] });
        await db.execute({
          sql: `INSERT OR IGNORE INTO purchases (id, user_id, idea_id, amount_usd, payment_method, payment_ref)
                VALUES (?, ?, ?, ?, 'paystack', ?)`,
          args: [randomUUID(), userId || null, ideaId, amountKobo / 100000, reference],
        });
        console.log('[Paystack webhook] Unlocked idea:', ideaId, 'user:', userId || 'anonymous');
      } catch (err) {
        console.error('[Paystack webhook] DB update failed:', err);
        return res.status(500).json({ error: 'DB update failed' });
      }
    }
  }

  return res.status(200).json({ received: true });
});

app.use(cookieParser());
app.use(express.json());

// ─── Database setup ───────────────────────────────────────────────────────────
try { mkdirSync('/data', { recursive: true }); } catch {}
const DB_PATH = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || 'file:./data.db';
export const db = createClient({
  url: DB_PATH,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── Corruption recovery ──────────────────────────────────────────────────────
function isCorruptError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  const code = (e?.code as string) || ((e?.cause as Record<string, unknown>)?.code as string) || '';
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB';
}

function deleteLocalDb() {
  if (!DB_PATH.startsWith('file:')) return;
  const filePath = DB_PATH.replace(/^file:/, '');
  try { fs.unlinkSync(filePath); } catch {}
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL DEFAULT '',
    source_title TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    pain_points TEXT NOT NULL DEFAULT '[]',
    target_audience TEXT NOT NULL DEFAULT '',
    competitor_gap TEXT NOT NULL DEFAULT '',
    mvp_concept TEXT NOT NULL DEFAULT '',
    gtm_strategy TEXT NOT NULL DEFAULT '',
    score_opportunity INTEGER NOT NULL DEFAULT 0,
    score_feasibility INTEGER NOT NULL DEFAULT 0,
    score_novelty INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    is_unlocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- v2 full-pitch fields
    opportunity TEXT NOT NULL DEFAULT '',
    problem TEXT NOT NULL DEFAULT '',
    market_fit TEXT NOT NULL DEFAULT '',
    business_model TEXT NOT NULL DEFAULT '',
    value_prop TEXT NOT NULL DEFAULT '',
    why_now TEXT NOT NULL DEFAULT '',
    timing TEXT NOT NULL DEFAULT '',
    community_signal TEXT NOT NULL DEFAULT '',
    proof_signals TEXT NOT NULL DEFAULT '[]',
    keywords TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL DEFAULT 'other',
    source TEXT NOT NULL DEFAULT 'url',
    score_timing INTEGER NOT NULL DEFAULT 0,
    score_market_fit INTEGER NOT NULL DEFAULT 0,
    session_id TEXT NOT NULL DEFAULT ''
  )
`;

// Idempotent migration: add any missing columns to existing tables
const V2_COLUMNS = [
  ['opportunity', 'TEXT NOT NULL DEFAULT \'\''],
  ['problem', 'TEXT NOT NULL DEFAULT \'\''],
  ['market_fit', 'TEXT NOT NULL DEFAULT \'\''],
  ['business_model', 'TEXT NOT NULL DEFAULT \'\''],
  ['value_prop', 'TEXT NOT NULL DEFAULT \'\''],
  ['why_now', 'TEXT NOT NULL DEFAULT \'\''],
  ['timing', 'TEXT NOT NULL DEFAULT \'\''],
  ['community_signal', 'TEXT NOT NULL DEFAULT \'\''],
  ['proof_signals', 'TEXT NOT NULL DEFAULT \'[]\''],
  ['keywords', 'TEXT NOT NULL DEFAULT \'[]\''],
  ['category', 'TEXT NOT NULL DEFAULT \'other\''],
  ['source', 'TEXT NOT NULL DEFAULT \'url\''],
  ['score_timing', 'INTEGER NOT NULL DEFAULT 0'],
  ['score_market_fit', 'INTEGER NOT NULL DEFAULT 0'],
  ['session_id', 'TEXT NOT NULL DEFAULT \'\''],
] as const;

// Auth + user tables
const CREATE_AUTH_TABLES = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_sign_in_at TEXT
  );
  CREATE TABLE IF NOT EXISTS magic_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    amount_usd REAL NOT NULL DEFAULT 1.0,
    payment_method TEXT NOT NULL DEFAULT 'lemonsqueezy',
    payment_ref TEXT NOT NULL DEFAULT '',
    credits INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS saved_ideas (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, idea_id)
  );
`;

async function migrateSchema() {
  const info = await db.execute('PRAGMA table_info(ideas)');
  const existing = new Set(info.rows.map(r => (r as unknown as Record<string, unknown>).name as string));
  for (const [col, def] of V2_COLUMNS) {
    if (!existing.has(col)) {
      await db.execute(`ALTER TABLE ideas ADD COLUMN ${col} ${def}`);
      console.log(`[db] Added column: ${col}`);
    }
  }
  // Auth tables (idempotent — CREATE TABLE IF NOT EXISTS)
  for (const stmt of CREATE_AUTH_TABLES.split(';').map(s => s.trim()).filter(Boolean)) {
    await db.execute(stmt);
  }
}

// ─── Init DB + seed ───────────────────────────────────────────────────────────
(async () => {
  const initSchema = () => db.execute(CREATE_TABLE);

  try {
    await initSchema();
  } catch (err) {
    if (isCorruptError(err)) {
      console.error('[db] Corrupt database — wiping and reinitializing');
      deleteLocalDb();
      await initSchema();
    } else {
      throw err;
    }
  }

  await migrateSchema();

  const countResult = await db.execute('SELECT COUNT(*) as c FROM ideas');
  const count = Number(countResult.rows[0].c);

  if (count === 0) {
    // Seed 6 sample ideas (with v2 fields backfilled)
    const seeds = [
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://news.ycombinator.com/item?id=example1',
        source_title: 'HN: The hidden cost of async standups',
        title: 'Async Standup That Actually Works',
        summary: 'Engineering teams using async standups waste 15–25 min/person/day in shallow text status updates with no escalation. A structured tool with smart thread aggregation and blocker surfacing would recover that time and surface the signal managers actually need.',
        pain_points: JSON.stringify(['Context-switching between async updates and real-time meetings destroys deep work blocks', 'Status updates capture activity, not blockers — the signal that matters gets buried in Slack threads', 'No automated escalation when a blocker sits unacknowledged for 24+ hours']),
        target_audience: 'Engineering managers at 20–150 person companies using remote-first culture and Slack-based async standups',
        competitor_gap: "Geekbot and Range are process-automation tools, not intelligence tools. They surface what people type, not what's actually blocking the team.",
        mvp_concept: "A Slack bot that asks the standup questions but routes any blocked response to the manager DM immediately and generates a 5-line daily digest by 10am.",
        gtm_strategy: "Start in Indie Hackers and HN Show HN threads targeting solo eng managers. Offer a 14-day free pilot.",
        score_opportunity: 84, score_feasibility: 88, score_novelty: 62,
        opportunity: 'The remote-first standup market is large and underserved — millions of teams still run synchronous standups out of habit. A focused digest tool has clear $5/seat/month revenue potential.',
        problem: 'Teams waste hours on status-sharing rituals that capture activity instead of surfacing blockers. The signal that matters — who is stuck — gets buried in Slack noise.',
        market_fit: 'Strong fit with remote-first engineering teams at growth-stage startups who value async culture but lack tooling.',
        business_model: 'Per-seat SaaS at $5/seat/month. 10-person team = $50/month. Target 200 teams in year 1 = $120k ARR.',
        value_prop: 'Replace your daily standup with a 60-second async digest that surfaces blockers, not just status.',
        why_now: 'Remote work norms are permanent. Teams that adopted async during the pandemic are now codifying it into tooling.',
        timing: 'Ideal — remote-first is mainstream but tooling is still primitive.',
        community_signal: 'High discussion volume in r/remotework and Hacker News about async standup failures.',
        proof_signals: JSON.stringify(['Geekbot has 40k+ paying customers despite poor UX', 'Multiple "anyone know a good async standup tool?" posts per week on HN', '#remote-work channels in every major SaaS Slack']),
        keywords: JSON.stringify(['async standup', 'remote team tools', 'engineering productivity', 'slack bot', 'team digest']),
        category: 'productivity', source: 'hn',
        score_timing: 82, score_market_fit: 85,
        tags: JSON.stringify(['productivity', 'remote work', 'SaaS']),
        is_unlocked: 1,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://reddit.com/r/startups/comments/example2',
        source_title: 'Reddit r/startups: We lost a deal because of our onboarding',
        title: 'Sales-to-Onboarding Handoff Intelligence',
        summary: 'B2B sales teams lose 20–40% of new deals in the first 90 days due to failed handoffs where deal context evaporates after contract signing. A lightweight tool that auto-packages deal context from CRM and routes it to CS prevents the most preventable form of churn.',
        pain_points: JSON.stringify(['Sales context evaporates the moment a deal closes', 'CS teams fly blind in the critical first 30 days', 'No automated accountability between sales commit and first value moment']),
        target_audience: 'CS directors at B2B SaaS companies with ACV over $10k and a dedicated CS team',
        competitor_gap: 'Gainsight and Totango require 6-month implementations. Notion templates have no CRM integration. The gap is a 15-minute setup tool that sucks context from HubSpot on deal close.',
        mvp_concept: 'A HubSpot app that triggers on deal-closed-won, formats a CS handoff card, and sends it to the CS rep via email and Slack. v1 is a template generator with one CRM integration.',
        gtm_strategy: 'Cold outreach to CS directors on LinkedIn. Partner with HubSpot Solutions Partners.',
        score_opportunity: 91, score_feasibility: 79, score_novelty: 74,
        opportunity: 'B2B churn in the first 90 days is a multi-billion dollar problem. A $200/mo tool that prevents one churn event per quarter pays for itself 50x.',
        problem: 'Deal context — champion name, pain points, objections overcome — evaporates at contract signing. CS teams start blind.',
        market_fit: 'CS directors at Series A-B SaaS companies desperately need this and have budget for a $200/month tool.',
        business_model: 'Per-seat at $30/CS rep/month or flat $200/month per team. Land with 5-rep teams, expand as they hire.',
        value_prop: 'Give every new customer the CS rep who already knows their entire sales journey — on day one.',
        why_now: 'SaaS churn visibility has never been higher. CS teams are being held accountable for NRR metrics for the first time.',
        timing: 'Ideal — CS is now a strategic function, not just support.',
        community_signal: 'r/CustomerSuccess and LinkedIn CS communities are flooded with handoff failure post-mortems.',
        proof_signals: JSON.stringify(['Gainsight raised $200M+ — proving the market is massive', 'Average B2B churn rate 5-7% annually, mostly in first 90 days', 'CS director job postings up 40% YoY']),
        keywords: JSON.stringify(['customer success', 'sales handoff', 'CRM integration', 'churn prevention', 'B2B SaaS']),
        category: 'B2B SaaS', source: 'reddit',
        score_timing: 79, score_market_fit: 88,
        tags: JSON.stringify(['B2B SaaS', 'customer success', 'CRM']),
        is_unlocked: 0,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://indiehackers.com/post/example3',
        source_title: 'Indie Hackers: Lessons from 3 failed SaaS launches',
        title: 'Pre-Launch Validation Dashboard',
        summary: 'Solo founders repeatedly burn 3–6 months building products nobody wants because they have no objective framework for killing bad ideas early. A validation tool that stress-tests assumptions with demand signals before a single line of code is written would save the indie ecosystem millions of wasted hours.',
        pain_points: JSON.stringify(['No objective framework to kill bad ideas early', 'Vanity signals from Twitter friends overestimate real demand', "Founders don't know what specific evidence should change their minds"]),
        target_audience: 'Solo founders and 2-person founding teams pre-launch who have built at least one failed product',
        competitor_gap: 'Landing page A/B tools measure conversion, not demand shape. Dovetail is post-launch. Nobody has built a structured pre-launch assumption stress-tester.',
        mvp_concept: 'A structured template + Airtable base that walks a founder through assumption mapping and defines specific experiments for each. v1 is a $29 template bundle.',
        gtm_strategy: 'Post the full validation framework on Indie Hackers as a free guide. Capture emails. Sell premium bundle to the list.',
        score_opportunity: 88, score_feasibility: 90, score_novelty: 77,
        opportunity: 'The solo founder market is 50M+ people globally. Even 0.1% converting at $29 = $1.5M. The failure rate of first-time founders is 90%+.',
        problem: 'Founders have no structured system for deciding when to kill an idea. Emotional investment overrides evidence.',
        market_fit: 'Any solo founder who has previously failed a launch — a large, self-aware segment willing to pay for a framework.',
        business_model: '$29 one-time template bundle → validate demand → build $49/month SaaS if 500 bundles sold.',
        value_prop: 'Know if your idea is dead before you build it — with evidence, not gut feel.',
        why_now: 'Post-pandemic entrepreneurship boom + AI-assisted building = more founders, faster iteration, same bad idea problem.',
        timing: 'Ideal — the no-code/AI tools explosion means more people are building, and more are failing faster.',
        community_signal: 'Indie Hackers forum has multiple threads per week asking "how do I validate before building?"',
        proof_signals: JSON.stringify(['Indie Hackers has 100k+ active members', 'Validate First newsletter has 30k subscribers', 'The Mom Test sold 100k+ copies']),
        keywords: JSON.stringify(['idea validation', 'pre-launch', 'founder tools', 'assumption testing', 'product market fit']),
        category: 'productivity', source: 'indiehackers',
        score_timing: 86, score_market_fit: 80,
        tags: JSON.stringify(['founder tools', 'validation', 'indie hackers']),
        is_unlocked: 0,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://news.ycombinator.com/item?id=example4',
        source_title: 'HN: My internal API docs are always out of date',
        title: 'Self-Healing API Documentation',
        summary: "Internal API docs rot within weeks of shipping because there's no closed loop between code changes and living documentation. A tool that attaches to CI/CD and auto-regenerates diffs catches breaking changes before they cost the team a lost weekend.",
        pain_points: JSON.stringify(["Docs go stale the moment they're published", 'Consuming teams have no notification when a breaking API change happens', 'Junior developers waste hours debugging what a README should explain']),
        target_audience: 'Backend engineering leads at growth-stage startups with 3+ internal API consumers and an active CI/CD pipeline',
        competitor_gap: 'Swagger/OpenAPI requires devs to maintain annotations. ReadMe and Stoplight are for external APIs. Nobody monitors actual CI diffs to auto-document breaking changes for internal APIs.',
        mvp_concept: 'A GitHub Action that compares API response shapes across commits, generates a changelog entry for shape changes, and posts a PR comment. v1 supports JSON REST APIs only.',
        gtm_strategy: 'Publish the GitHub Action on the marketplace for free. Write an SEO post on stopping manual API docs. Monetize with a hosted dashboard at $49/mo after 500 installs.',
        score_opportunity: 78, score_feasibility: 91, score_novelty: 65,
        opportunity: 'Every startup with 3+ backend services has this problem. A $49/month GitHub integration sells itself in the PR review workflow.',
        problem: "API docs rot because there's no automated enforcement. Developers forget; managers don't notice until a consuming team breaks.",
        market_fit: 'Backend teams at growth-stage startups are the exact audience that uses GitHub Actions and would pay $49/month for a productivity tool.',
        business_model: 'Free GitHub Action → $49/month hosted dashboard with diff history and team notifications. Land and expand.',
        value_prop: 'Never get surprised by a breaking API change again — catch it in the PR, not in production.',
        why_now: 'Microservices proliferation means more internal API consumers than ever. The surface area for breaking changes is growing.',
        timing: 'Ideal — microservices are mainstream, CI/CD is universal, but API observability tooling is still primitive.',
        community_signal: 'HN threads about "API docs that rot" get 200+ comments. Multiple GitHub issues requesting this in major frameworks.',
        proof_signals: JSON.stringify(['Postman has 20M+ users — proving API tooling demand', 'ReadMe raised $150M at $1.5B valuation', 'Every major startup engineering blog has a post about broken internal APIs']),
        keywords: JSON.stringify(['API documentation', 'developer tools', 'CI/CD', 'breaking changes', 'GitHub Action']),
        category: 'dev tools', source: 'hn',
        score_timing: 77, score_market_fit: 82,
        tags: JSON.stringify(['developer tools', 'API', 'documentation']),
        is_unlocked: 1,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://example.com/blog/competitive-analysis-broken',
        source_title: 'Blog: Why competitive analysis is broken for small teams',
        title: 'Lightweight Competitive Intelligence for Indie Makers',
        summary: 'Competitive intelligence tools are priced for enterprise and require a full-time analyst. A lightweight tracker that monitors competitor pricing pages, changelog blogs, and job postings gives indie makers board-room insights on a ramen budget.',
        pain_points: JSON.stringify(['Enterprise CI tools start at $500/mo — out of reach for bootstrappers', "Manual monitoring of 10 competitors eats 4 hours/week a solo founder doesn't have", 'Competitive moves surface too late — after the customer call already went cold']),
        target_audience: 'Bootstrapped indie makers tracking 3–15 competitors without a dedicated analyst',
        competitor_gap: 'Crayon and Klue are $15k/yr enterprise tools. Google Alerts miss structured signals. No tool targets indie makers with affordable pricing and automated change detection.',
        mvp_concept: 'A weekly email digest where you input competitor URLs and get a diff of what changed (pricing, product pages, job postings) every Monday. v1 is Puppeteer scraper + email digest. No dashboard.',
        gtm_strategy: 'Launch free tier (3 competitors, weekly digest) on ProductHunt targeting indie makers. Partner with Indie Hackers newsletter.',
        score_opportunity: 86, score_feasibility: 84, score_novelty: 68,
        opportunity: 'The indie maker market is 5M+ active builders. A $29/month tool that saves 4 hours/week of manual research sells on pure time ROI.',
        problem: 'Indie makers have no affordable way to monitor competitors systematically. They rely on manual checking and miss critical moves.',
        market_fit: 'Any bootstrapped founder tracking competitors — a large, actively engaged audience on Product Hunt and Indie Hackers.',
        business_model: 'Free tier (3 competitors) → $29/month pro (unlimited competitors, instant alerts). Target 1000 paying users = $29k MRR.',
        value_prop: 'Know every competitor move every Monday morning — for less than your Netflix subscription.',
        why_now: 'The indie maker movement is at peak size. There are more bootstrapped founders than ever, all needing this at a price they can afford.',
        timing: 'Ideal — indie makers are mainstream, the market is large, and the enterprise tools are still priced out of reach.',
        community_signal: 'Product Hunt and Indie Hackers have dozens of posts per week asking for affordable competitor monitoring.',
        proof_signals: JSON.stringify(['Crayon raised $22M — proving enterprise demand', 'G2 has 200+ reviews for "competitive intelligence" tools, all enterprise-priced', 'Indie Hackers has 20+ posts asking for affordable CI tools']),
        keywords: JSON.stringify(['competitive intelligence', 'competitor monitoring', 'indie makers', 'market research', 'bootstrapped']),
        category: 'B2B SaaS', source: 'blog',
        score_timing: 80, score_market_fit: 83,
        tags: JSON.stringify(['competitive intelligence', 'indie makers', 'SaaS']),
        is_unlocked: 0,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://reddit.com/r/SaaS/comments/example6',
        source_title: 'Reddit r/SaaS: Nobody warned me about seat-based pricing backlash',
        title: 'Usage-Based Pricing Migration Playbook',
        summary: 'Hundreds of SaaS companies are fleeing seat-based pricing but have no structured way to model the revenue impact or communicate the change to existing customers. A tool that simulates the P&L shift is a $50k consulting engagement at a $200 price point.',
        pain_points: JSON.stringify(['Revenue impact modeling is done in fragile spreadsheets that break on edge cases', 'No standardized playbook for grandfathering legacy pricing', 'Poorly communicated pricing changes churn loyal customers']),
        target_audience: 'Founders and RevOps leads at SaaS companies with $500k–$5M ARR considering a pricing model switch',
        competitor_gap: 'Paddle and Stripe have billing infrastructure but no migration playbook. Notion templates have no live modeling. No one outputs the grandfathering schedule and customer email sequence automatically.',
        mvp_concept: 'A spreadsheet model + email template bundle for $149: current ARR re-modeling under usage pricing, a grandfathering framework, and 5 customer communication templates segmented by tier.',
        gtm_strategy: 'Post the full migration framework as a long-form article on SaaStr and LinkedIn. Capture emails with a free Pricing Migration Readiness Checklist. Sell the bundle to the list.',
        score_opportunity: 83, score_feasibility: 76, score_novelty: 81,
        opportunity: 'SaaS pricing optimization is a $50k+ consulting engagement. Compressing it to a $149 product captures massive value at 1% of the cost.',
        problem: 'RevOps teams have no structured tool to model pricing migration scenarios. They rely on fragile spreadsheets and reinvent the wheel every time.',
        market_fit: 'RevOps leads at $500k–$5M ARR SaaS companies — a specific, reachable segment actively discussing this on SaaStr and LinkedIn.',
        business_model: '$149 template bundle → $499 interactive web tool for larger companies → $200/month SaaS for ongoing pricing analytics.',
        value_prop: 'Model your pricing migration in 30 minutes instead of 30 days — without a consultant.',
        why_now: 'OpenAI\'s usage-based pricing made the model mainstream. Every SaaS founder is now re-evaluating seat-based pricing.',
        timing: 'Ideal — usage-based pricing is the dominant conversation in SaaS right now.',
        community_signal: 'SaaStr, ChartMogul blog, and LinkedIn RevOps communities are flooded with pricing migration questions.',
        proof_signals: JSON.stringify(['Paddle raised $200M+ on usage-based billing infrastructure', 'SaaStr annual conference dedicated an entire track to pricing in 2025', '40% of SaaS companies plan to switch pricing models in next 2 years (Maxio survey)']),
        keywords: JSON.stringify(['usage-based pricing', 'SaaS pricing', 'RevOps', 'pricing migration', 'pricing strategy']),
        category: 'B2B SaaS', source: 'reddit',
        score_timing: 90, score_market_fit: 84,
        tags: JSON.stringify(['SaaS', 'pricing', 'RevOps']),
        is_unlocked: 0,
      },
    ];

    for (const idea of seeds) {
      await db.execute({
        sql: `INSERT INTO ideas (
          id, url, source_title, title, summary, pain_points, target_audience,
          competitor_gap, mvp_concept, gtm_strategy,
          score_opportunity, score_feasibility, score_novelty,
          opportunity, problem, market_fit, business_model, value_prop,
          why_now, timing, community_signal, proof_signals, keywords,
          category, source, score_timing, score_market_fit,
          tags, is_unlocked
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?
        )`,
        args: [
          idea.id, idea.url, idea.source_title, idea.title, idea.summary,
          idea.pain_points, idea.target_audience,
          idea.competitor_gap, idea.mvp_concept, idea.gtm_strategy,
          idea.score_opportunity, idea.score_feasibility, idea.score_novelty,
          idea.opportunity, idea.problem, idea.market_fit, idea.business_model, idea.value_prop,
          idea.why_now, idea.timing, idea.community_signal, idea.proof_signals, idea.keywords,
          idea.category, idea.source, idea.score_timing, idea.score_market_fit,
          idea.tags, idea.is_unlocked,
        ],
      });
    }
    console.log('[db] Seeded 6 sample ideas with full v2 fields.');
  }

  // Boot: check Argens wallet status (non-blocking warning)
  agentStatus().then(status => {
    if (status.wallet_status !== 'READY') {
      console.warn('[argens] Wallet not READY:', status.wallet_status, '— analysis and feed will fail until resolved.');
    } else {
      console.log(`[argens] Wallet READY. Balance: ${status.wallet_balance} USDC. Allowance remaining: ${status.policies.allowance_remaining} USDC.`);
    }
  }).catch(err => {
    console.warn('[argens] Could not check agent status:', err instanceof Error ? err.message : err);
  });

  // Start curated idea-feed background scheduler (no-op if FEED_ENABLED != 1)
  startFeedScheduler(db);
})();

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || 'ophunt-dev-secret-change-in-prod';
const APP_URL = process.env.APP_URL || 'http://localhost:4100';
// FRONTEND_URL is where the React app lives — different from APP_URL in dev
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173';
const COOKIE_NAME = 'ophunt_auth';

interface JwtPayload { userId: string; email: string }

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    // Dev fallback: log link to console if Resend isn't configured
    console.log(`[auth] RESEND_API_KEY not set. Magic link for ${email}: ${link}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'OpHunt <noreply@ophunt.io>',
      to: [email],
      subject: 'Sign in to OpHunt',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <h2 style="font-size:24px;font-weight:600;margin:0 0 8px">Your sign-in link</h2>
          <p style="color:#555;margin:0 0 24px">Click the button below to sign in to OpHunt. This link expires in 15 minutes.</p>
          <a href="${link}" style="display:inline-block;background:#ff4d8b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:15px">Sign in to OpHunt</a>
          <p style="color:#999;font-size:12px;margin:24px 0 0">If you didn't request this, you can safely ignore it.</p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error: ${err}`);
  }
}

// Auth middleware — reads httpOnly cookie, attaches user to req
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired — please sign in again' });
  (req as express.Request & { user: JwtPayload }).user = payload;
  next();
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

// Send magic link
app.post('/api/auth/send-magic-link', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  // Upsert user
  const userId = `user_${randomUUID().slice(0, 12)}`;
  await db.execute({
    sql: `INSERT INTO users (id, email) VALUES (?, ?)
          ON CONFLICT(email) DO UPDATE SET email = email`,
    args: [userId, email.toLowerCase()],
  });
  const userRow = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase()] });
  const realUserId = (userRow.rows[0] as unknown as { id: string }).id;

  // Generate token
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await db.execute({
    sql: 'INSERT INTO magic_links (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    args: [randomUUID(), realUserId, tokenHash, expiresAt],
  });

  const link = `${APP_URL}/api/auth/verify?token=${rawToken}`;
  try {
    await sendMagicLinkEmail(email.toLowerCase(), link);
  } catch (err) {
    console.error('[auth] Email send failed:', err instanceof Error ? err.message : err);
    return res.status(502).json({ error: 'Failed to send email — check RESEND_API_KEY' });
  }

  res.json({ ok: true, message: 'Check your email for the sign-in link' });
});

// Verify magic link token (server-side redirect)
app.get('/api/auth/verify', async (req, res) => {
  const { token } = req.query as { token?: string };
  if (!token) return res.redirect(`${FRONTEND_URL}/?auth=invalid`);

  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const linkRow = await db.execute({
    sql: `SELECT ml.id, ml.user_id, ml.expires_at, ml.used_at, u.email
          FROM magic_links ml JOIN users u ON u.id = ml.user_id
          WHERE ml.token_hash = ?`,
    args: [tokenHash],
  });
  const link = linkRow.rows[0] as unknown as {
    id: string; user_id: string; expires_at: string; used_at: string | null; email: string;
  } | undefined;

  if (!link) return res.redirect(`${FRONTEND_URL}/?auth=invalid`);
  if (link.used_at) return res.redirect(`${FRONTEND_URL}/?auth=used`);
  if (link.expires_at < now) return res.redirect(`${FRONTEND_URL}/?auth=expired`);

  // Mark used + update last sign in
  await Promise.all([
    db.execute({ sql: 'UPDATE magic_links SET used_at = ? WHERE id = ?', args: [now, link.id] }),
    db.execute({ sql: 'UPDATE users SET last_sign_in_at = ? WHERE id = ?', args: [now, link.user_id] }),
  ]);

  const jwtToken = signToken({ userId: link.user_id, email: link.email });
  res.cookie(COOKIE_NAME, jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.redirect(`${FRONTEND_URL}/explore`);
});

// Current user
app.get('/api/auth/me', (req, res) => {
  const token = (req.cookies as Record<string, string>)?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired' });
  res.json({ user: { id: payload.userId, email: payload.email } });
});

// Sign out
app.post('/api/auth/sign-out', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ─── Saved ideas routes ────────────────────────────────────────────────────────

app.post('/api/ideas/:id/save', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: JwtPayload }).user;
  const ideaId = String(req.params.id);
  const check = await db.execute({ sql: 'SELECT id FROM ideas WHERE id = ?', args: [ideaId] });
  if (!check.rows[0]) return res.status(404).json({ error: 'Idea not found' });
  try {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO saved_ideas (id, user_id, idea_id) VALUES (?, ?, ?)',
      args: [randomUUID(), user.userId, ideaId],
    });
    res.json({ ok: true, saved: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/ideas/:id/save', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: JwtPayload }).user;
  const ideaId = String(req.params.id);
  await db.execute({
    sql: 'DELETE FROM saved_ideas WHERE user_id = ? AND idea_id = ?',
    args: [user.userId, ideaId],
  });
  res.json({ ok: true, saved: false });
});

app.get('/api/me/saved', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: JwtPayload }).user;
  const result = await db.execute({
    sql: `SELECT i.* FROM ideas i
          JOIN saved_ideas s ON s.idea_id = i.id
          WHERE s.user_id = ?
          ORDER BY s.created_at DESC`,
    args: [user.userId],
  });
  const rows = result.rows as unknown as Record<string, unknown>[];
  res.json({ ideas: rows.map(formatIdea) });
});

app.get('/api/me/unlocked', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: JwtPayload }).user;
  const result = await db.execute({
    sql: `SELECT DISTINCT i.* FROM ideas i
          JOIN purchases p ON p.idea_id = i.id
          WHERE p.user_id = ?
          ORDER BY p.created_at DESC`,
    args: [user.userId],
  });
  const rows = result.rows as unknown as Record<string, unknown>[];
  res.json({ ideas: rows.map(formatIdea) });
});

// ─── Paystack initiate checkout ────────────────────────────────────────────────

app.post('/api/payments/paystack/initiate', async (req, res) => {
  const paystackKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackKey) return res.status(503).json({ error: 'Paystack not configured' });

  const { ideaId, email, userId } = req.body as { ideaId?: string; email?: string; userId?: string };
  if (!ideaId || !email) return res.status(400).json({ error: 'ideaId and email are required' });

  const check = await db.execute({ sql: 'SELECT id FROM ideas WHERE id = ?', args: [ideaId] });
  if (!check.rows[0]) return res.status(404).json({ error: 'Idea not found' });

  const amountNGN = Number(process.env.PAYSTACK_AMOUNT_KOBO) || 150000; // ₦1,500 in kobo
  const callbackUrl = `${FRONTEND_URL}/report/${ideaId}?unlocked=1`;

  try {
    const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${paystackKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amount: amountNGN,
        callback_url: callbackUrl,
        metadata: { idea_id: ideaId, user_id: userId || '' },
      }),
    });
    const psData = await psRes.json() as { status: boolean; data?: { authorization_url: string; reference: string } };
    if (!psData.status || !psData.data) {
      return res.status(502).json({ error: 'Paystack initialization failed' });
    }
    res.json({ checkoutUrl: psData.data.authorization_url, reference: psData.data.reference });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/_apidocs', (_req, res) => {
  res.type('html').send(`
    <!doctype html><html lang="en">
    <head><meta charset="utf-8"><title>OpHunt API</title>
    <style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;background:#fffaf0;color:#0a0a0a}code{background:#f0e8d8;padding:2px 6px;border-radius:4px;font-size:13px}li{margin-bottom:8px}</style>
    </head><body>
    <h1>OpHunt API</h1>
    <ul>
      <li><code>GET /health</code> — service health check</li>
      <li><code>GET /api/health</code> — frontend proxy health check</li>
      <li><code>GET /api/ideas</code> — list ideas (supports ?category=&source=&sort=novelty|timing|opportunity|recent&limit=)</li>
      <li><code>GET /api/ideas/:id</code> — full idea report</li>
      <li><code>GET /api/feed</code> — latest 20 ideas</li>
      <li><code>POST /api/analyze</code> — analyze a URL (requires ARGENS_API_KEY)</li>
      <li><code>POST /api/ideas/:id/unlock</code> — mark idea as unlocked</li>
      <li><code>GET /api/admin/argens/llm-providers</code> — discover available LLM providers (requires X-Admin-Token)</li>
      <li><code>POST /api/admin/refresh-feed</code> — trigger a curated feed run (requires X-Admin-Token)</li>
    </ul>
    </body></html>
  `);
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'ophunt-api' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ophunt-api' }));

// Debug env
app.get('/api/debug-env', (_req, res) => {
  res.json({
    argensKeyPresent: !!process.env.ARGENS_API_KEY,
    argensKeyPrefix: process.env.ARGENS_API_KEY?.slice(0, 12) || null,
    apiBase: process.env.ARGENS_API_BASE_URL || 'https://api.argens.xyz/v1',
    llmServiceId: process.env.ARGENS_LLM_SERVICE_ID || '(not set)',
    scrapeServiceId: process.env.ARGENS_SCRAPE_SERVICE_ID || 'firecrawl_scrape',
    mockMode: process.env.ARGENS_MOCK === '1',
    feedEnabled: process.env.FEED_ENABLED === '1',
  });
});

// ─── Admin auth middleware ─────────────────────────────────────────────────────
function adminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Forbidden — X-Admin-Token required' });
  }
  next();
}

// Discover LLM providers available on Argens marketplace
app.get('/api/admin/argens/llm-providers', adminAuth, async (_req, res) => {
  try {
    const services = await discoverServices('llm');
    res.json({
      message: 'Pick a provider, enable it at https://argens.xyz/dashboard/marketplace, then set ARGENS_LLM_SERVICE_ID to the chosen endpoint id (endpoints[].id, NOT the provider id)',
      current: process.env.ARGENS_LLM_SERVICE_ID || '(not set)',
      providers: services.map(s => ({
        providerId: s.id,
        name: s.name,
        enabled: s.is_enabled,
        price: s.display_price,
        skillFile: s.skill_url,
        endpoints: s.endpoints?.map(e => ({ endpointId: e.id, label: e.label, price: e.price })),
      })),
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// Manual feed trigger
app.post('/api/admin/refresh-feed', adminAuth, (_req, res) => {
  runFeedOnce(db).catch((err: unknown) => console.error('[feed] runFeedOnce error:', err));
  res.json({ ok: true, message: 'Feed run triggered (async — check server logs for progress)' });
});

// ─── Ideas routes ─────────────────────────────────────────────────────────────

// List ideas with optional filters
app.get('/api/ideas', async (req, res) => {
  const { category, source, sort, limit } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (category) { conditions.push('category = ?'); args.push(category); }
  if (source) { conditions.push('source = ?'); args.push(source); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderMap: Record<string, string> = {
    novelty: 'score_novelty DESC',
    timing: 'score_timing DESC',
    opportunity: 'score_opportunity DESC',
    marketfit: 'score_market_fit DESC',
    recent: 'created_at DESC',
  };
  const order = orderMap[sort?.toLowerCase() || ''] || 'created_at DESC';

  const lim = Math.min(Number(limit) || 100, 200);
  const result = await db.execute({
    sql: `SELECT * FROM ideas ${where} ORDER BY ${order} LIMIT ${lim}`,
    args: args as InValue[],
  });
  const rows = result.rows as unknown as Record<string, unknown>[];
  res.json({ ideas: rows.map(formatIdea) });
});

// Feed route — latest 20 ideas
app.get('/api/feed', async (_req, res) => {
  const result = await db.execute('SELECT * FROM ideas ORDER BY created_at DESC LIMIT 20');
  const rows = result.rows as unknown as Record<string, unknown>[];

  if (rows.length > 0) return res.json({ ideas: rows.map(formatIdea) });

  // Fallback when DB is empty (before first seed or feed run)
  const fallback = [
    { id: 'sample_001', url: '', sourceTitle: 'HN: The hidden cost of async standups', title: 'Async Standup That Actually Works', summary: 'Engineering teams waste 15–25 min/person/day in shallow async status updates. A structured tool with blocker surfacing would recover that time.', targetAudience: 'Engineering managers at remote-first companies', scores: { opportunity: 84, feasibility: 88, novelty: 62, timing: 82, marketFit: 85 }, tags: ['productivity', 'SaaS'], category: 'productivity', source: 'hn', keywords: [], createdAt: new Date().toISOString(), isUnlocked: false },
    { id: 'sample_002', url: '', sourceTitle: 'Reddit r/startups: We lost a deal because of our onboarding', title: 'Sales-to-Onboarding Handoff Intelligence', summary: 'B2B sales teams lose 20–40% of new deals in the first 90 days due to context evaporating at contract signing.', targetAudience: 'CS directors at B2B SaaS companies', scores: { opportunity: 91, feasibility: 79, novelty: 74, timing: 79, marketFit: 88 }, tags: ['B2B SaaS'], category: 'B2B SaaS', source: 'reddit', keywords: [], createdAt: new Date(Date.now() - 86400000).toISOString(), isUnlocked: false },
  ];
  res.json({ ideas: fallback });
});

// Get single idea
app.get('/api/ideas/:id', async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM ideas WHERE id = ?', args: [req.params.id] });
  const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: 'Idea not found' });
  res.json(formatIdea(row));
});

// Analyze a URL or topic — returns up to 3 quality-gated ideas
app.post('/api/analyze', async (req, res) => {
  const { url, topic } = req.body as { url?: string; topic?: string };
  const input = url?.trim() || topic?.trim();
  if (!input) return res.status(400).json({ error: 'url or topic is required' });

  const isUrl = !!url?.trim();
  const sessionId = randomUUID();

  try {
    const result = await analyzeContent({
      url: isUrl ? input : `topic:${input}`,
      source: isUrl ? 'url' : 'topic',
      rawContent: isUrl ? undefined : `Topic for analysis: ${input}`,
      rawTitle: isUrl ? undefined : input,
    });

    if (result.ideas.length === 0) {
      return res.json({
        ideas: [],
        message: result.noIdeasReason || 'No viable startup opportunities found in this source.',
      });
    }

    const persisted = await Promise.all(
      result.ideas.map(idea => persistIdea(db, idea, { sessionId })),
    );

    res.json({ ideas: persisted });
  } catch (err) {
    console.error('[analyze] error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

// Check unlock status
app.get('/api/ideas/:id/unlock-status', async (req, res) => {
  const result = await db.execute({ sql: 'SELECT is_unlocked FROM ideas WHERE id = ?', args: [req.params.id] });
  const row = result.rows[0] as unknown as { is_unlocked: number } | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ isUnlocked: Boolean(row.is_unlocked) });
});

// Unlock an idea (LemonSqueezy checkout integration point)
app.post('/api/ideas/:id/unlock', async (req, res) => {
  const checkResult = await db.execute({ sql: 'SELECT id FROM ideas WHERE id = ?', args: [req.params.id] });
  if (!checkResult.rows[0]) return res.status(404).json({ error: 'Idea not found' });
  await db.execute({ sql: 'UPDATE ideas SET is_unlocked = 1 WHERE id = ?', args: [req.params.id] });
  res.json({ ok: true, message: 'Idea unlocked' });
});

// ─── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[express error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Static frontend ───────────────────────────────────────────────────────────
const publicDir = path.join(process.cwd(), 'public');
const indexHtml = path.join(publicDir, 'index.html');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) { next(); return; }
  if (fs.existsSync(indexHtml)) { res.sendFile(indexHtml); return; }
  next();
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT) || 8080;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`OpHunt API listening on port ${port}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('[server error]', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.close(() => { console.log('Server closed'); process.exit(0); });
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
