import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { createClient } from '@libsql/client';
import { randomUUID, createHmac } from 'crypto';
import fs, { mkdirSync } from 'node:fs';

// Keep the process alive and log rather than crash on unexpected errors
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const app = express();
const ALLOWED_ORIGINS = new Set([
  'https://svc-mp4zvh3mcatzunzb.buildwithlocus.com',
  'http://localhost:8080',
  'http://localhost:5173',
]);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow any *.buildwithlocus.com subdomain
    if (/^https:\/\/[a-z0-9-]+\.buildwithlocus\.com$/.test(origin)) {
      return callback(null, true);
    }
    // Allow any *.locusfounder.com subdomain (preview pane, including multi-level like p-xxx.preview.locusfounder.com)
    if (/^https:\/\/[a-z0-9.-]+\.locusfounder\.com$/.test(origin)) {
      return callback(null, true);
    }
    if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    callback(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
}));
// ─── LemonSqueezy webhook — MUST be registered before express.json() ──────────
// Uses type: '*/*' to capture the raw Buffer regardless of the exact Content-Type
// string LemonSqueezy sends (e.g. "application/json; charset=utf-8" would be
// missed by the narrower 'application/json' matcher).
app.post('/api/webhooks/lemonsqueezy', express.raw({ type: '*/*' }), async (req, res) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || 'ophunt';
  const signature = req.headers['x-signature'] as string;

  const rawBody = req.body as Buffer;

  // Debug: log first 100 chars of what we actually received
  console.log('[LS webhook] Raw body preview:', rawBody?.toString('utf8')?.slice(0, 100));

  if (!signature) {
    console.warn('[LS webhook] Missing x-signature header — rejecting');
    return res.status(400).json({ error: 'Missing x-signature header' });
  }

  // Compute expected HMAC-SHA256
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  console.log('[LS webhook] Expected signature:', expected);
  console.log('[LS webhook] Received signature:', signature);

  if (signature !== expected) {
    console.warn('[LS webhook] Signature mismatch — rejecting (possible spoofed request)');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.error('[LS webhook] JSON parse failed');
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const meta = payload.meta as Record<string, unknown> | undefined;
  const eventName = meta?.event_name as string | undefined;
  console.log('[LS webhook] Event received:', eventName);

  if (eventName === 'order_created') {
    // idea_id lives in meta.custom_data (NOT data.attributes)
    const ideaId = (meta?.custom_data as Record<string, unknown> | undefined)?.idea_id as string | undefined;

    if (ideaId) {
      try {
        await db.execute({ sql: 'UPDATE ideas SET is_unlocked = 1 WHERE id = ?', args: [ideaId] });
        console.log('[LS webhook] Unlocked idea:', ideaId);
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
  if (!idea_id) {
    return res.status(400).json({ error: 'idea_id is required in request body' });
  }
  try {
    const check = await db.execute({ sql: 'SELECT id FROM ideas WHERE id = ?', args: [idea_id] });
    if (!check.rows[0]) return res.status(404).json({ error: 'Idea not found' });
    await db.execute({ sql: 'UPDATE ideas SET is_unlocked = 1 WHERE id = ?', args: [idea_id] });
    console.log('[LS webhook BYPASS] Unlocked idea:', idea_id);
    res.json({ ok: true, idea_id, message: 'Idea unlocked via bypass (no signature check)' });
  } catch (err) {
    console.error('[LS webhook BYPASS] DB error:', err);
    res.status(500).json({ error: String(err) });
  }
});

app.use(express.json());

// ─── Database setup ───────────────────────────────────────────────────────────
// Create /data directory for persistent volume mounts (no-op if it already exists or isn't mounted)
try { mkdirSync('/data', { recursive: true }); } catch {}
const DB_PATH = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || 'file:./data.db';
const db = createClient({
  url: DB_PATH,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatIdea(row: Record<string, unknown>) {
  return {
    id: row.id,
    url: row.url,
    sourceTitle: row.source_title,
    title: row.title,
    summary: row.summary,
    painPoints: JSON.parse(row.pain_points as string || '[]'),
    targetAudience: row.target_audience,
    competitorGap: row.competitor_gap,
    mvpConcept: row.mvp_concept,
    gtmStrategy: row.gtm_strategy,
    scores: {
      opportunity: row.score_opportunity,
      feasibility: row.score_feasibility,
      novelty: row.score_novelty,
    },
    tags: JSON.parse(row.tags as string || '[]'),
    isUnlocked: Boolean(row.is_unlocked),
    createdAt: row.created_at,
  };
}

// ─── Corruption recovery helper ───────────────────────────────────────────────
function isCorruptError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  return e?.code === 'SQLITE_CORRUPT' ||
    (e?.cause as Record<string, unknown>)?.code === 'SQLITE_CORRUPT';
}

function deleteLocalDb() {
  // Only meaningful for local file: URLs — Turso remote URLs are left alone
  if (!DB_PATH.startsWith('file:')) return;
  const filePath = DB_PATH.replace(/^file:/, '');
  try { fs.unlinkSync(filePath); console.log('[db] Deleted corrupt database file:', filePath); } catch {}
}

// ─── Init DB + seed (async IIFE) ──────────────────────────────────────────────
(async () => {
  // Attempt schema setup; if the file is corrupt, wipe it and retry once.
  const initSchema = () => db.execute(`
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  try {
    await initSchema();
  } catch (err) {
    if (isCorruptError(err)) {
      console.error('[db] Corrupt database on startup — wiping and reinitializing');
      deleteLocalDb();
      await initSchema(); // fresh empty file; will succeed
    } else {
      throw err;
    }
  }

  const countResult = await db.execute('SELECT COUNT(*) as c FROM ideas');
  const count = Number(countResult.rows[0].c);

  if (count === 0) {
    const seedIdeas = [
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://news.ycombinator.com/item?id=example1',
        source_title: 'HN: The hidden cost of async standups',
        title: 'Async Standup That Actually Works',
        summary: 'Engineering teams using async standups waste 15–25 min/person/day in shallow text status updates with no escalation. A structured tool with smart thread aggregation and blocker surfacing would recover that time and surface the signal managers actually need.',
        pain_points: JSON.stringify([
          'Context-switching between async updates and real-time meetings destroys deep work blocks',
          'Status updates capture activity, not blockers — the signal that matters gets buried in Slack threads',
          'No automated escalation when a blocker sits unacknowledged for 24+ hours',
        ]),
        target_audience: 'Engineering managers at 20–150 person companies using remote-first culture and Slack-based async standups',
        competitor_gap: "Geekbot and Range are process-automation tools, not intelligence tools — they surface what people type, not what's actually blocking the team. Neither has blocker-escalation routing, dependency mapping, or a manager digest that collapses 12 updates into 3 actionable signals. The wedge is the digest, not the form.",
        mvp_concept: "A Slack bot that asks the standup questions but routes any blocked response to the manager DM immediately, groups related updates by project, and generates a 5-line daily digest by 10am. No dashboard needed for v1 — the digest is the product. Validate with 5 eng managers in week 1.",
        gtm_strategy: "Start in Indie Hackers and HN Show HN threads targeting solo eng managers at remote-first startups. Offer a 14-day free pilot with a same-day setup Calendly. First 100 customers come from communities, not ads — post the digest example tweet weekly to show the value artifact.",
        score_opportunity: 84,
        score_feasibility: 88,
        score_novelty: 62,
        tags: JSON.stringify(['productivity', 'remote work', 'SaaS']),
        is_unlocked: 1,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://reddit.com/r/startups/comments/example2',
        source_title: 'Reddit r/startups: We lost a deal because of our onboarding',
        title: 'Sales-to-Onboarding Handoff Intelligence',
        summary: 'B2B sales teams lose 20–40% of new deals in the first 90 days due to failed handoffs where deal context evaporates after contract signing. A lightweight tool that auto-packages deal context from CRM and routes it to CS would prevent the most preventable form of churn in the industry.',
        pain_points: JSON.stringify([
          'Sales context — pain points, champion name, objections overcome — evaporates the moment a deal closes',
          'CS teams fly blind in the critical first 30 days while the customer is deciding if they made a mistake',
          'No automated accountability checkpoint between sales commit and customer success first value moment',
        ]),
        target_audience: 'CS directors at B2B SaaS companies with ACV over $10k and a dedicated CS team of 3 or more people',
        competitor_gap: 'Gainsight and Totango are massive platforms requiring 6-month implementations — unusable for a $2M ARR startup. Notion templates exist but have no CRM integration. The gap is a 15-minute setup tool that sucks context from HubSpot/Salesforce on deal close and creates a living customer context card accessible to the whole CS team.',
        mvp_concept: 'A HubSpot app that triggers on deal-closed-won, pulls the deal notes and contact info, formats them into a standard CS handoff card, and sends it to the assigned CS rep via email and Slack. The v1 is a template generator with one CRM integration. Validate with 10 CS directors before building the Slack bot.',
        gtm_strategy: "Cold outreach to CS directors on LinkedIn who have posted about onboarding failures. Partner with HubSpot Solutions Partners who see this failure weekly at client sites. First 100 comes from a combination of HubSpot marketplace listing and LinkedIn DMs with a compelling before/after handoff card example.",
        score_opportunity: 91,
        score_feasibility: 79,
        score_novelty: 74,
        tags: JSON.stringify(['B2B SaaS', 'customer success', 'CRM']),
        is_unlocked: 0,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://indiehackers.com/post/example3',
        source_title: 'Indie Hackers: Lessons from 3 failed SaaS launches',
        title: 'Pre-Launch Validation Dashboard',
        summary: 'Solo founders repeatedly burn 3–6 months building products nobody wants because they have no objective framework for killing bad ideas early. A validation tool that stress-tests assumptions with demand signals and synthetic user panels before a single line of code is written would save the indie ecosystem millions of wasted hours.',
        pain_points: JSON.stringify([
          'No objective framework to kill bad ideas early — founders over-invest emotionally in the wrong direction',
          'Vanity signals from Twitter and friends massively overestimate demand compared to what strangers will pay',
          "Most validation advice is vague; founders don't know what specific evidence should change their minds",
        ]),
        target_audience: 'Solo founders and 2-person founding teams pre-launch who have built at least one failed product before',
        competitor_gap: 'Landing page A/B tools measure conversion but not demand shape. User interview tools like Dovetail are post-launch research instruments. Nobody has built a structured pre-launch assumption stress-tester that maps assumptions to specific validation experiments with pass/fail criteria. The IdeaFlip and AirBnB-napkin frameworks exist as blog posts — not products.',
        mvp_concept: 'A structured Google Docs template + Airtable base that walks a founder through assumption mapping, defines specific experiments for each assumption, and tracks evidence. v1 is a $29 template bundle. If 500 people buy it, build the SaaS. The product validates the market before you build it — meta-appropriate.',
        gtm_strategy: "Post the full validation framework on Indie Hackers as a free guide. Capture emails. Sell the premium template bundle to the list. Repeat on ProductHunt and Hacker News Show HN. If 100 people buy at $29, you have enough signal and $2,900 to build a lightweight SaaS. Bootstrap the distribution before the product.",
        score_opportunity: 88,
        score_feasibility: 90,
        score_novelty: 77,
        tags: JSON.stringify(['founder tools', 'validation', 'indie hackers']),
        is_unlocked: 0,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://news.ycombinator.com/item?id=example4',
        source_title: 'HN: My internal API docs are always out of date',
        title: 'Self-Healing API Documentation',
        summary: "Internal API docs rot within weeks of shipping because there's no closed loop between code changes and living documentation. A tool that attaches to CI/CD and auto-regenerates diffs catches breaking changes before they cost the team a lost weekend and an angry Slack thread from a dependent team.",
        pain_points: JSON.stringify([
          "Docs go stale the moment they're published — no one has time to update them manually after a sprint",
          'Consuming teams have no notification when a breaking API change affects their service',
          'Junior developers waste hours debugging what a well-maintained README should explain in 5 lines',
        ]),
        target_audience: 'Backend engineering leads at growth-stage startups with 3 or more internal API consumers and an active CI/CD pipeline',
        competitor_gap: 'Swagger/OpenAPI generates docs from annotations but requires devs to maintain the annotations — same maintenance burden, different format. ReadMe and Stoplight are for external APIs. Nobody has built an opinionated tool that monitors actual API traffic and CI diffs to auto-detect and document breaking changes for internal APIs specifically.',
        mvp_concept: 'A GitHub Action that compares API response shapes across commits using a lightweight schema inference engine, generates a changelog entry for any shape change, and posts a PR comment. v1 supports JSON REST APIs only. Validate by offering it free to 20 startups with 3+ internal services and measuring whether they actually use the changelog.',
        gtm_strategy: "Publish the GitHub Action on the marketplace for free. Write an SEO-targeted post on stopping manual API docs. Submit to Changelog, DevHunt, and HN Show HN. Monetize with a hosted dashboard at $49/mo after 500 free installs prove retention. First 100 customers are GitHub marketplace organic installs.",
        score_opportunity: 78,
        score_feasibility: 91,
        score_novelty: 65,
        tags: JSON.stringify(['developer tools', 'API', 'documentation']),
        is_unlocked: 1,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://example.com/blog/competitive-analysis-broken',
        source_title: 'Blog: Why competitive analysis is broken for small teams',
        title: 'Lightweight Competitive Intelligence for Indie Makers',
        summary: 'Competitive intelligence tools are priced for enterprise and require a full-time analyst to extract signal. A lightweight tracker that monitors competitor pricing pages, changelog blogs, and job postings gives indie makers board-room insights on a ramen budget — and makes the first 5 minutes of every board meeting automatic.',
        pain_points: JSON.stringify([
          'Enterprise CI tools start at $500/mo minimum — completely out of reach for bootstrapped indie makers',
          "Manual monitoring of 10 competitors eats 4 hours/week that a solo founder doesn't have",
          "Competitive moves surface too late — after the customer call that already went cold because you didn't know about the competitor's new feature",
        ]),
        target_audience: 'Bootstrapped indie makers and early-stage startup founders actively tracking 3–15 competitors without a dedicated analyst',
        competitor_gap: 'Crayon and Klue are $15k/yr enterprise tools. Google Alerts miss structured signals like pricing changes. No tool specifically targets the indie maker segment with affordable pricing, automated change detection across pricing pages, job boards, and changelogs, and a simple weekly digest format. The gap is the weekly digest at $29/mo, not another enterprise dashboard.',
        mvp_concept: 'A weekly email digest service where you input competitor URLs and get a diff of what changed (pricing, product pages, job postings) every Monday morning. v1 is a Puppeteer scraper + email digest. No dashboard. Validate by getting 50 people to pay $9/mo for the email. If retained for 60 days, build the dashboard.',
        gtm_strategy: 'Launch the free tier (3 competitors, weekly digest) on ProductHunt targeting the indie maker community. Convert free users by showing them a specific competitive move they missed without the paid tier. Partner with Indie Hackers newsletter for a sponsored post. First 100 customers come from the PH launch and the IH audience — no outbound needed at this stage.',
        score_opportunity: 86,
        score_feasibility: 84,
        score_novelty: 68,
        tags: JSON.stringify(['competitive intelligence', 'indie makers', 'SaaS']),
        is_unlocked: 0,
      },
      {
        id: `seed_${randomUUID().slice(0, 8)}`,
        url: 'https://reddit.com/r/SaaS/comments/example6',
        source_title: 'Reddit r/SaaS: Nobody warned me about seat-based pricing backlash',
        title: 'Usage-Based Pricing Migration Playbook',
        summary: 'Hundreds of SaaS companies are fleeing seat-based pricing but have no structured way to model the revenue impact or communicate the change to existing customers. A tool that simulates the P&L shift and generates customer communication templates is a $50k consulting engagement compressed into a $200 product.',
        pain_points: JSON.stringify([
          'Revenue impact modeling for a pricing migration is done in fragile spreadsheets that break on edge cases',
          'No standardized playbook for grandfathering legacy pricing — every company reinvents this wheel',
          'Poorly communicated pricing changes churn loyal customers who were actually happy with the product',
        ]),
        target_audience: 'Founders and RevOps leads at SaaS companies with $500k–$5M ARR actively considering a switch from seat-based to usage-based or outcome-based pricing',
        competitor_gap: 'Paddle and Stripe have usage-based billing infrastructure but no migration playbook or customer communication tooling. Notion templates exist for the playbook but have no live modeling. No one has built a tool that takes your current ARR distribution, simulates the usage-based equivalent, and outputs the grandfathering schedule and customer email sequence automatically.',
        mvp_concept: 'A spreadsheet model + email template bundle for $149 that includes: current revenue re-modeling under usage pricing, a grandfathering decision framework, and 5 customer communication templates segmented by customer tier. Sell the bundle first. If 200 people buy it, build the interactive web tool. Spreadsheets are the right v1 for a playbook product.',
        gtm_strategy: "Post the full pricing migration framework as a long-form article on SaaStr and LinkedIn where pricing discussions dominate. Capture emails with a free Pricing Migration Readiness Checklist. Sell the full bundle to the list. Target RevOps communities on Slack and Pavilion. First 100 customers come from content-led distribution to an audience already discussing this problem.",
        score_opportunity: 83,
        score_feasibility: 76,
        score_novelty: 81,
        tags: JSON.stringify(['SaaS', 'pricing', 'RevOps']),
        is_unlocked: 0,
      },
    ];

    for (const idea of seedIdeas) {
      await db.execute({
        sql: `INSERT INTO ideas (id, url, source_title, title, summary, pain_points, target_audience,
          competitor_gap, mvp_concept, gtm_strategy, score_opportunity, score_feasibility,
          score_novelty, tags, is_unlocked)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          idea.id, idea.url, idea.source_title, idea.title, idea.summary,
          idea.pain_points, idea.target_audience, idea.competitor_gap,
          idea.mvp_concept, idea.gtm_strategy, idea.score_opportunity,
          idea.score_feasibility, idea.score_novelty, idea.tags, idea.is_unlocked,
        ],
      });
    }
    console.log('Seeded 6 sample ideas.');
  }
})();

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
      <li><code>GET /api/ideas</code> — list all ideas (card view)</li>
      <li><code>GET /api/ideas/:id</code> — full idea report</li>
      <li><code>POST /api/analyze</code> — analyze a URL (requires LOCUS_API_KEY)</li>
      <li><code>POST /api/ideas/:id/unlock</code> — mark an idea as unlocked</li>
    </ul>
    </body></html>
  `);
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'ophunt-api' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ophunt-api' }));

// Debug env — confirms injected secrets are present without exposing full values
app.get('/api/debug-env', (_req, res) => {
  res.json({
    locusKeyPresent: !!process.env.LOCUS_API_KEY,
    locusKeyPrefix: process.env.LOCUS_API_KEY?.slice(0, 8) || null,
    apiBase: process.env.LOCUS_API_BASE_URL || 'https://beta-api.paywithlocus.com',
  });
});

// List ideas (card view — all fields)
app.get('/api/ideas', async (_req, res) => {
  const result = await db.execute('SELECT * FROM ideas ORDER BY created_at DESC');
  const rows = result.rows as unknown as Record<string, unknown>[];
  res.json({ ideas: rows.map(formatIdea) });
});

// Feed route — latest 20 ideas, with hardcoded fallback when DB is empty
app.get('/api/feed', async (_req, res) => {
  const result = await db.execute('SELECT * FROM ideas ORDER BY created_at DESC LIMIT 20');
  const rows = result.rows as unknown as Record<string, unknown>[];

  if (rows.length > 0) {
    return res.json({ ideas: rows.map(formatIdea) });
  }

  // Fallback: DB is empty, return 3 realistic sample ideas
  const fallback = [
    {
      id: 'sample_001',
      url: '',
      sourceTitle: 'HN: The hidden cost of async standups',
      title: 'Async Standup That Actually Works',
      summary: 'Engineering teams using async standups waste 15–25 min/person/day in shallow text status updates with no escalation. A structured tool with smart thread aggregation and blocker surfacing would recover that time and surface the signal managers actually need.',
      targetAudience: 'Engineering managers at 20–150 person companies using remote-first culture',
      scores: { opportunity: 84, feasibility: 88, novelty: 62 },
      tags: ['productivity', 'remote work', 'SaaS'],
      createdAt: new Date().toISOString(),
      isUnlocked: false,
    },
    {
      id: 'sample_002',
      url: '',
      sourceTitle: 'Reddit r/startups: We lost a deal because of our onboarding',
      title: 'Sales-to-Onboarding Handoff Intelligence',
      summary: 'B2B sales teams lose 20–40% of new deals in the first 90 days due to failed handoffs where deal context evaporates after contract signing. A lightweight tool that auto-packages deal context from CRM and routes it to CS would prevent the most preventable form of churn.',
      targetAudience: 'CS directors at B2B SaaS companies with ACV over $10k and a dedicated CS team',
      scores: { opportunity: 91, feasibility: 79, novelty: 74 },
      tags: ['B2B SaaS', 'customer success', 'CRM'],
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      isUnlocked: false,
    },
    {
      id: 'sample_003',
      url: '',
      sourceTitle: 'Indie Hackers: Lessons from 3 failed SaaS launches',
      title: 'Pre-Launch Validation Dashboard',
      summary: 'Solo founders repeatedly burn 3–6 months building products nobody wants because they have no objective framework for killing bad ideas early. A validation tool that stress-tests assumptions with demand signals before a single line of code is written would save the indie ecosystem millions of wasted hours.',
      targetAudience: 'Solo founders and 2-person founding teams pre-launch who have built at least one failed product',
      scores: { opportunity: 88, feasibility: 90, novelty: 77 },
      tags: ['founder tools', 'validation', 'indie hackers'],
      createdAt: new Date(Date.now() - 172800000).toISOString(),
      isUnlocked: false,
    },
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

// Analyze a URL
app.post('/api/analyze', async (req, res) => {
  const apiBase = process.env.LOCUS_API_BASE_URL || 'https://beta-api.paywithlocus.com';
  const apiKey = process.env.LOCUS_API_KEY || '';

  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  // ── DEV FALLBACK (disabled) ───────────────────────────────────────────────────
  if (false) {
    console.log('[analyze] DEV MODE — returning mock idea (no API key)');

    const isReddit = url.includes('reddit.com');
    const isHN = url.includes('news.ycombinator.com') || url.includes('hn.');
    const isIndieHackers = url.includes('indiehackers.com');

    const mock = isReddit
      ? {
          sourceTitle: 'Reddit r/entrepreneurs: Why do community tools still suck?',
          title: 'Reddit Thread Opportunity Detector',
          summary: 'Thousands of Reddit threads surface genuine unmet needs every day, but founders have no systematic way to catch them before the moment passes. A lightweight crawler that scores threads by pain intensity and reply velocity would give solo founders a daily signal feed worth acting on.',
          painPoints: [
            'Founders manually scroll Reddit hoping to stumble on a good thread',
            'High-signal threads disappear from the front page within hours',
            'No tool aggregates cross-subreddit pain signals into a ranked opportunity list',
          ],
          targetAudience: 'Solo founders and indie hackers who use Reddit as a market research tool but spend more than 30 minutes a day doing it manually',
          competitorGap: 'Existing social-listening tools target enterprise brand monitoring, not founder opportunity discovery. They are expensive, noisy, and not calibrated for "is this a buildable startup idea?" — leaving the indie market completely underserved.',
          mvpConcept: 'Build a daily digest service that monitors 20 high-signal subreddits, scores posts by reply count × sentiment × keyword density, and emails a ranked list of the top 5 opportunities each morning. No dashboard needed for v1 — validate via email open rates.',
          gtmStrategy: 'Post the tool in r/SideProject, r/Entrepreneur, and Indie Hackers Show HH. Offer the first 500 users a free week. Reach out directly to the top 50 "build in public" Twitter/X founders with a personalised first-run report as a cold open.',
          scores: { opportunity: 84, feasibility: 88, novelty: 76 },
          tags: ['founder tools', 'Reddit', 'opportunity discovery'],
        }
      : isHN
      ? {
          sourceTitle: 'Hacker News: Ask HN — what problem are you still solving with spreadsheets?',
          title: 'Spreadsheet-to-SaaS Conversion Kit',
          summary: 'SMBs keep critical workflows locked in fragile Excel files because off-the-shelf SaaS tools either over-build or under-fit. A service that ingests a spreadsheet and generates a lightweight, shareable web app around it would capture the enormous "operational spreadsheet" market before no-code incumbents notice.',
          painPoints: [
            'Business-critical data lives in email-shared spreadsheets with no access control',
            'No-code platforms have steep learning curves and vendor lock-in',
            'Custom dev quotes for simple tools start at $10k+',
          ],
          targetAudience: 'Operations managers at 10–100-person companies who own a workflow spreadsheet shared with 5+ teammates and dread the day a formula breaks',
          competitorGap: 'Airtable and Notion require users to re-model data from scratch. AppSheet requires Google Workspace. None of them start from the user\'s existing spreadsheet structure — a huge friction barrier this tool eliminates on day one.',
          mvpConcept: 'Accept an uploaded CSV/XLSX, parse the schema, and auto-generate a read/write web interface with basic filtering and row editing. Host it on a shareable subdomain. Skip auth, roles, and automations for v1 — just prove people will pay to replace their spreadsheet.',
          gtmStrategy: 'Target Hacker News "Ask HN" threads about spreadsheets and reply with the tool link. Write a teardown post on Indie Hackers. Partner with two bookkeeping or ops consultants who can resell it to their existing clients at a markup.',
          scores: { opportunity: 87, feasibility: 81, novelty: 72 },
          tags: ['no-code', 'SMB tools', 'spreadsheet automation'],
        }
      : isIndieHackers
      ? {
          sourceTitle: 'Indie Hackers: How I got to $2k MRR by doing things that don\'t scale',
          title: 'Founder Traction Playbook Generator',
          summary: 'Early-stage founders waste weeks debating growth tactics that don\'t match their specific product, audience, or stage. A tool that takes three inputs — product type, ICP, and current MRR — and returns a prioritised, time-boxed traction playbook would cut that decision cost to minutes.',
          painPoints: [
            'Generic growth advice ignores stage and market context',
            'Founders context-switch between 10 different frameworks without committing to one',
            'Most traction templates are written for VC-backed startups, not bootstrappers',
          ],
          targetAudience: 'Bootstrapped founders under $5k MRR who have paying users but no repeatable acquisition channel yet',
          competitorGap: 'Existing growth playbooks are either too generic (blog posts) or too expensive (growth agencies). No tool combines specificity of context with the speed of a template — leaving founders stuck in analysis paralysis.',
          mvpConcept: 'A three-question form (product type, audience, current traction) that generates a 90-day traction plan with weekly checkpoints. Use Claude to personalise the output. Validate via a $29 one-time purchase before building any saved-state or account system.',
          gtmStrategy: 'Launch on Indie Hackers, Product Hunt, and Twitter/X build-in-public threads. Offer free plans for founders who share their results publicly — turn outputs into social proof. Partner with two popular bootstrapper newsletters for a sponsored mention.',
          scores: { opportunity: 82, feasibility: 92, novelty: 69 },
          tags: ['founder tools', 'growth', 'indie hackers'],
        }
      : {
          sourceTitle: 'SaaS teardown: the hidden cost of async status updates',
          title: 'Async Status Page for Small Teams',
          summary: 'Small product teams burn 3–5 hours per week in unnecessary sync meetings whose only purpose is sharing status that could be asynchronous. A lightweight, opinionated daily standup tool designed for teams under 15 would reclaim that time without requiring a process overhaul.',
          painPoints: [
            'Daily standups routinely run long because there is no structured input format',
            'Status shared in Slack threads is impossible to review retroactively',
            'Project managers spend hours chasing updates that should surface automatically',
          ],
          targetAudience: 'Engineering leads at 5–20-person product teams who run daily standups over Zoom and feel they waste at least 30 minutes a day on status overhead',
          competitorGap: 'Geekbot and Standuply solve the automation angle but produce noisy Slack noise nobody reads. Linear and Jira surface task status but not human context. No tool combines structured async input with a digest that is actually worth reading.',
          mvpConcept: 'A Slack bot that prompts three questions at 9am, collects answers, and posts a single team digest at 9:05am. No dashboards, no integrations, no settings — just the bot and one beautiful daily digest. Charge per team seat after a 14-day free trial.',
          gtmStrategy: 'Cold-email 50 engineering managers on LinkedIn who post about remote work. Post in relevant Slack communities (e.g. Rands Leadership, remote-work Discords). Write a "we killed our daily standup" teardown post and submit to Hacker News.',
          scores: { opportunity: 79, feasibility: 93, novelty: 71 },
          tags: ['async work', 'team tools', 'productivity'],
        };

    const id = `idea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    await db.execute({
      sql: `INSERT INTO ideas (id, url, source_title, title, summary, pain_points, target_audience,
        competitor_gap, mvp_concept, gtm_strategy, score_opportunity, score_feasibility,
        score_novelty, tags, is_unlocked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      args: [
        id, url,
        mock.sourceTitle,
        mock.title,
        mock.summary,
        JSON.stringify(mock.painPoints),
        mock.targetAudience,
        mock.competitorGap,
        mock.mvpConcept,
        mock.gtmStrategy,
        mock.scores.opportunity,
        mock.scores.feasibility,
        mock.scores.novelty,
        JSON.stringify(mock.tags),
      ],
    });

    const mockRowResult = await db.execute({ sql: 'SELECT * FROM ideas WHERE id = ?', args: [id] });
    const mockRow = mockRowResult.rows[0] as unknown as Record<string, unknown>;
    return res.json(formatIdea(mockRow));
  }
  // ── END DEV FALLBACK ──────────────────────────────────────────────────────────

  try {
    // 1. Scrape the URL with firecrawl
    let pageContent = '';
    let pageTitle = '';
    try {
      const scrapeRes = await fetch(`${apiBase}/api/wrapped/firecrawl/scrape`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      });
      if (scrapeRes.ok) {
        const scrapeData = await scrapeRes.json() as { data?: { markdown?: string; metadata?: { title?: string } } };
        pageContent = scrapeData.data?.markdown || '';
        pageTitle = scrapeData.data?.metadata?.title || '';
      }
    } catch (scrapeErr) {
      console.warn('Scraping failed, proceeding with URL only:', scrapeErr);
    }

    // 2. Analyze with Anthropic Claude
    const systemPrompt = `You are OpHunt, an expert startup opportunity analyst. Given content from a URL, extract exactly one specific, buildable startup opportunity that a solo founder could ship in 90 days.

Return ONLY a raw JSON object — no markdown fences, no code blocks, no preamble, no explanation. Start your response with { and end with }. The exact structure:
{
  "sourceTitle": "Brief descriptive title of the source content (10 words max)",
  "title": "Punchy startup idea title (5-8 words, no buzzwords)",
  "summary": "2-3 sentences describing the opportunity clearly. Lead with the pain size. End with why now.",
  "painPoints": ["Specific pain point 1", "Specific pain point 2", "Specific pain point 3"],
  "targetAudience": "Specific ICP: job title, company size, specific context that makes this painful for them",
  "competitorGap": "2-3 sentences on what existing solutions miss and why this specific gap is the opening",
  "mvpConcept": "3-4 sentences on the minimum viable product that validates the core thesis in 90 days. Be specific about what to build first and what to leave out.",
  "gtmStrategy": "3-4 sentences on first 100 customers acquisition. Name specific channels, communities, or tactics.",
  "scores": {
    "opportunity": <integer 0-100, size and urgency of the market need>,
    "feasibility": <integer 0-100, how buildable is this for a solo founder>,
    "novelty": <integer 0-100, how differentiated vs existing solutions>
  },
  "tags": ["tag1", "tag2", "tag3"]
}`;

    const userContent = pageContent
      ? `URL: ${url}\n\nPage title: ${pageTitle}\n\nContent:\n${pageContent.slice(0, 10000)}`
      : `URL: ${url}\n\nNo content could be scraped. Analyze based on the URL structure and domain context.`;

    const analysisRes = await fetch(`${apiBase}/api/wrapped/anthropic/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!analysisRes.ok) {
      const errText = await analysisRes.text();
      return res.status(502).json({ error: `Analysis upstream failed: ${errText.slice(0, 200)}` });
    }

    const analysisData = await analysisRes.json() as {
      success?: boolean;
      data?: { content?: { type: string; text: string }[] };
      content?: { type: string; text: string }[];
    };
    // Locus proxy wraps the Anthropic response under `data`; fall back to top-level for direct calls
    const contentBlocks = analysisData.data?.content ?? analysisData.content;
    const content = contentBlocks?.[0]?.text;

    if (!content) {
      return res.status(502).json({ error: 'Empty response from analysis model' });
    }

    let parsed: {
      sourceTitle?: string; title?: string; summary?: string;
      painPoints?: string[]; targetAudience?: string;
      competitorGap?: string; mvpConcept?: string; gtmStrategy?: string;
      scores?: { opportunity?: number; feasibility?: number; novelty?: number };
      tags?: string[];
    };
    try {
      // Strip any accidental markdown fences Claude may add
      const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: 'Could not parse idea from page' });
    }

    const id = `idea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    await db.execute({
      sql: `INSERT INTO ideas (id, url, source_title, title, summary, pain_points, target_audience,
        competitor_gap, mvp_concept, gtm_strategy, score_opportunity, score_feasibility,
        score_novelty, tags, is_unlocked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      args: [
        id, url,
        parsed.sourceTitle || pageTitle || url,
        parsed.title || 'Untitled Opportunity',
        parsed.summary || '',
        JSON.stringify(parsed.painPoints || []),
        parsed.targetAudience || '',
        parsed.competitorGap || '',
        parsed.mvpConcept || '',
        parsed.gtmStrategy || '',
        parsed.scores?.opportunity ?? 0,
        parsed.scores?.feasibility ?? 0,
        parsed.scores?.novelty ?? 0,
        JSON.stringify(parsed.tags || []),
      ],
    });

    const rowResult = await db.execute({ sql: 'SELECT * FROM ideas WHERE id = ?', args: [id] });
    const row = rowResult.rows[0] as unknown as Record<string, unknown>;
    res.json(formatIdea(row));

  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// (LemonSqueezy webhook handler is registered above, before express.json())

// Check unlock status (used by frontend polling)
app.get('/api/ideas/:id/unlock-status', async (req, res) => {
  const result = await db.execute({ sql: 'SELECT is_unlocked FROM ideas WHERE id = ?', args: [req.params.id] });
  const row = result.rows[0] as unknown as { is_unlocked: number } | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ isUnlocked: Boolean(row.is_unlocked) });
});

// Unlock an idea (Locus Checkout integration point)
app.post('/api/ideas/:id/unlock', async (req, res) => {
  const checkResult = await db.execute({ sql: 'SELECT id FROM ideas WHERE id = ?', args: [req.params.id] });
  if (!checkResult.rows[0]) return res.status(404).json({ error: 'Idea not found' });
  await db.execute({ sql: 'UPDATE ideas SET is_unlocked = 1 WHERE id = ?', args: [req.params.id] });
  res.json({ ok: true, message: 'Idea unlocked' });
});

// ─── Global Express error handler ──────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[express error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
// Serve the built frontend. In the deployed single-service container the
// frontend's production build is copied to ./public next to this server, so
// Express is the single origin for the UI and /api — the browser calls
// /api/... with relative paths. The existsSync guards make this a no-op during
// preview, where ./public does not exist.
const publicDir = path.join(process.cwd(), 'public');
const indexHtml = path.join(publicDir, 'index.html');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    next();
    return;
  }
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
    return;
  }
  next();
});

const port = Number(process.env.PORT) || 8080;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`OpHunt API listening on port ${port}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('[server error]', err);
  process.exit(1);
});

// Graceful shutdown — let the process manager restart cleanly
process.on('SIGTERM', () => {
  console.log('SIGTERM received — closing server');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});