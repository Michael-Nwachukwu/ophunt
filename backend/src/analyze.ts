/**
 * Shared analysis engine.
 * Used by POST /api/analyze and the curated idea-feed worker.
 */

import { randomUUID } from 'node:crypto';
import { scrapeUrl, llmComplete } from './argens.js';
import type { Client } from '@libsql/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  'AI tools',
  'dev tools',
  'consumer apps',
  'B2B SaaS',
  'fintech',
  'productivity',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface AnalyzedIdea {
  id: string;
  url: string;
  sourceTitle: string;
  title: string;
  summary: string;
  painPoints: string[];
  targetAudience: string;
  competitorGap: string;
  mvpConcept: string;
  gtmStrategy: string;
  // Full pitch spec fields
  opportunity: string;
  problem: string;
  marketFit: string;
  businessModel: string;
  valueProp: string;
  whyNow: string;
  timing: string;
  communitySignal: string;
  proofSignals: string[];
  keywords: string[];
  category: Category;
  scores: {
    opportunity: number;
    feasibility: number;
    novelty: number;
    timing: number;
    marketFit: number;
  };
  tags: string[];
  source: string;
  isUnlocked: boolean;
  createdAt: string;
}

// ─── Mock idea (ARGENS_MOCK=1) ────────────────────────────────────────────────

function mockIdea(url: string, source: string): Omit<AnalyzedIdea, 'id' | 'isUnlocked' | 'createdAt'> {
  return {
    url,
    source,
    sourceTitle: 'Mock: Hacker News — Ask HN: What problem are you solving?',
    title: 'Async Status Digest for Small Teams',
    summary: 'Small product teams burn 3–5 hours per week in unnecessary sync meetings whose only purpose is sharing status. A lightweight, opinionated async standup tool designed for teams under 15 would reclaim that time without requiring a process overhaul.',
    painPoints: [
      'Daily standups routinely run long because there is no structured input format',
      'Status shared in Slack threads is impossible to review retroactively',
      'Project managers spend hours chasing updates that should surface automatically',
    ],
    targetAudience: 'Engineering leads at 5–20-person product teams who run daily standups and feel they waste at least 30 minutes a day on status overhead',
    competitorGap: 'Geekbot and Standuply automate the form but produce noisy Slack noise nobody reads. Linear and Jira surface task status but not human context. No tool combines structured async input with a digest that is actually worth reading.',
    mvpConcept: 'A Slack bot that prompts three questions at 9am, collects answers, and posts a single team digest at 9:05am. No dashboards, no integrations, no settings — just the bot and one beautiful daily digest.',
    gtmStrategy: 'Cold-email 50 engineering managers on LinkedIn who post about remote work. Post in relevant Slack communities. Write a "we killed our daily standup" teardown post and submit to Hacker News.',
    opportunity: 'The async work market is accelerating post-pandemic with millions of remote-first teams still running synchronous standups out of habit. The timing is ideal for a focused, opinionated tool.',
    problem: 'Teams lose hours each week to status-sharing rituals that exist only because there is no better system — not because sync meetings add value.',
    marketFit: 'Strong fit with remote-first engineering teams at growth-stage startups who value async culture but lack tooling to support it.',
    businessModel: 'Per-seat SaaS at $5/seat/month. 10-person team = $50/month. First year target: 200 teams = $120k ARR.',
    valueProp: 'Replace your daily standup with a 60-second async digest that surfaces blockers, not just status.',
    whyNow: 'Remote work norms are permanent. Teams that adopted async during the pandemic are now codifying it into tooling. The window for a focused async standup tool is open before Slack and Linear build it in.',
    timing: 'Ideal — remote-first is mainstream, async culture is established, but tooling is still primitive.',
    communitySignal: 'High discussion volume in r/remotework, Hacker News, and remote-first Slack communities. Multiple "anyone know a good async standup tool?" posts per week.',
    proofSignals: [
      'Geekbot has 40k+ paying customers despite a poor UX',
      '#remote-work channels in every major SaaS company Slack',
      'Hacker News thread "Ask HN: how does your team do async standups?" with 300+ comments',
    ],
    keywords: ['async standup', 'remote team tools', 'engineering productivity', 'team communication', 'slack bot'],
    category: 'productivity',
    scores: { opportunity: 79, feasibility: 93, novelty: 71, timing: 82, marketFit: 85 },
    tags: ['async work', 'team tools', 'productivity'],
  };
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are OpHunt, an expert startup opportunity analyst. Given content from a URL or signal source, extract exactly one specific, buildable startup opportunity that a solo founder could ship in 90 days.

Return ONLY a raw JSON object — no markdown fences, no code blocks, no preamble, no explanation. Start your response with { and end with }. The exact structure:

{
  "sourceTitle": "Brief descriptive title of the source content (10 words max)",
  "title": "Punchy startup idea title (5-8 words, no buzzwords)",
  "summary": "2-3 sentences describing the opportunity. Lead with the pain size. End with why now.",
  "painPoints": ["Specific pain point 1", "Specific pain point 2", "Specific pain point 3"],
  "targetAudience": "Specific ICP: job title, company size, specific context that makes this painful",
  "competitorGap": "2-3 sentences on what existing solutions miss and why this specific gap is the opening",
  "mvpConcept": "3-4 sentences on the minimum viable product to validate the core thesis in 90 days",
  "gtmStrategy": "3-4 sentences on first 100 customers. Name specific channels, communities, or tactics.",
  "opportunity": "2-3 sentences on the size and urgency of the market opportunity",
  "problem": "2-3 sentences precisely defining the core problem this solves",
  "marketFit": "2-3 sentences on product-market fit: why this specific solution fits this specific audience now",
  "businessModel": "2-3 sentences on how this makes money: pricing model, unit economics, path to $10k MRR",
  "valueProp": "One punchy sentence — the core value proposition (what does the user get and why it beats alternatives)",
  "whyNow": "2-3 sentences on why this specific moment in time is right to build this",
  "timing": "One sentence summary of market timing (early/ideal/late and why)",
  "communitySignal": "1-2 sentences on community discussion, forum posts, or social signals showing the pain is real",
  "proofSignals": ["Signal 1 with data point", "Signal 2 with data point", "Signal 3 with data point"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "category": "one of: AI tools | dev tools | consumer apps | B2B SaaS | fintech | productivity | other",
  "scores": {
    "opportunity": <integer 0-100, size and urgency of the market need>,
    "feasibility": <integer 0-100, how buildable for a solo founder in 90 days>,
    "novelty": <integer 0-100, how differentiated vs existing solutions>,
    "timing": <integer 0-100, how ideal is the market timing right now>,
    "marketFit": <integer 0-100, how well does this solution fit this specific audience>
  },
  "tags": ["tag1", "tag2", "tag3"]
}`;

// ─── Parse raw LLM text into structured idea ──────────────────────────────────

function parseLlmResponse(text: string): Omit<AnalyzedIdea, 'id' | 'url' | 'source' | 'isUnlocked' | 'createdAt'> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const p = JSON.parse(cleaned) as Record<string, unknown>;

  const scores = (p.scores || {}) as Record<string, unknown>;

  return {
    sourceTitle: (p.sourceTitle as string) || '',
    title: (p.title as string) || 'Untitled Opportunity',
    summary: (p.summary as string) || '',
    painPoints: (p.painPoints as string[]) || [],
    targetAudience: (p.targetAudience as string) || '',
    competitorGap: (p.competitorGap as string) || '',
    mvpConcept: (p.mvpConcept as string) || '',
    gtmStrategy: (p.gtmStrategy as string) || '',
    opportunity: (p.opportunity as string) || '',
    problem: (p.problem as string) || '',
    marketFit: (p.marketFit as string) || '',
    businessModel: (p.businessModel as string) || '',
    valueProp: (p.valueProp as string) || '',
    whyNow: (p.whyNow as string) || '',
    timing: (p.timing as string) || '',
    communitySignal: (p.communitySignal as string) || '',
    proofSignals: (p.proofSignals as string[]) || [],
    keywords: (p.keywords as string[]) || [],
    category: (CATEGORIES.includes(p.category as Category) ? p.category as Category : 'other'),
    scores: {
      opportunity: Number(scores.opportunity) || 0,
      feasibility: Number(scores.feasibility) || 0,
      novelty: Number(scores.novelty) || 0,
      timing: Number(scores.timing) || 0,
      marketFit: Number(scores.marketFit) || 0,
    },
    tags: (p.tags as string[]) || [],
  };
}

// ─── Main analysis function ───────────────────────────────────────────────────

export async function analyzeContent(opts: {
  url: string;
  source?: string;
  rawContent?: string;
  rawTitle?: string;
}): Promise<Omit<AnalyzedIdea, 'id' | 'isUnlocked' | 'createdAt'>> {
  const source = opts.source || 'url';

  // Return mock in dev mode
  if (process.env.ARGENS_MOCK === '1') {
    console.log('[analyze] ARGENS_MOCK=1 — returning canned idea');
    return mockIdea(opts.url, source);
  }

  let pageContent = opts.rawContent || '';
  let pageTitle = opts.rawTitle || '';

  // Scrape if no content provided
  if (!pageContent && opts.url) {
    try {
      const scraped = await scrapeUrl(opts.url);
      pageContent = scraped.markdown;
      pageTitle = scraped.title || pageTitle;
    } catch (err) {
      console.warn('[analyze] Scraping failed, proceeding with URL only:', err instanceof Error ? err.message : err);
    }
  }

  const userContent = pageContent
    ? `URL: ${opts.url}\n\nPage title: ${pageTitle}\n\nContent:\n${pageContent.slice(0, 10000)}`
    : `URL: ${opts.url}\n\nNo content available. Analyze based on URL structure and domain context.`;

  const text = await llmComplete(SYSTEM_PROMPT, userContent, 2500);
  const parsed = parseLlmResponse(text);

  return {
    ...parsed,
    url: opts.url,
    source,
    sourceTitle: parsed.sourceTitle || pageTitle || opts.url,
  };
}

// ─── Persist to DB ────────────────────────────────────────────────────────────

export function formatIdea(row: Record<string, unknown>): AnalyzedIdea {
  return {
    id: row.id as string,
    url: row.url as string,
    sourceTitle: row.source_title as string,
    title: row.title as string,
    summary: row.summary as string,
    painPoints: JSON.parse((row.pain_points as string) || '[]'),
    targetAudience: row.target_audience as string,
    competitorGap: row.competitor_gap as string,
    mvpConcept: row.mvp_concept as string,
    gtmStrategy: row.gtm_strategy as string,
    opportunity: (row.opportunity as string) || '',
    problem: (row.problem as string) || '',
    marketFit: (row.market_fit as string) || '',
    businessModel: (row.business_model as string) || '',
    valueProp: (row.value_prop as string) || '',
    whyNow: (row.why_now as string) || '',
    timing: (row.timing as string) || '',
    communitySignal: (row.community_signal as string) || '',
    proofSignals: JSON.parse((row.proof_signals as string) || '[]'),
    keywords: JSON.parse((row.keywords as string) || '[]'),
    category: (row.category as Category) || 'other',
    source: (row.source as string) || 'url',
    scores: {
      opportunity: Number(row.score_opportunity) || 0,
      feasibility: Number(row.score_feasibility) || 0,
      novelty: Number(row.score_novelty) || 0,
      timing: Number(row.score_timing) || 0,
      marketFit: Number(row.score_market_fit) || 0,
    },
    tags: JSON.parse((row.tags as string) || '[]'),
    isUnlocked: Boolean(row.is_unlocked),
    createdAt: row.created_at as string,
  };
}

export async function persistIdea(
  db: Client,
  idea: Omit<AnalyzedIdea, 'id' | 'isUnlocked' | 'createdAt'>,
  opts: { isUnlocked?: boolean } = {},
): Promise<AnalyzedIdea> {
  const id = `idea_${Date.now()}_${randomUUID().slice(0, 7)}`;
  await db.execute({
    sql: `INSERT INTO ideas (
      id, url, source_title, title, summary, pain_points, target_audience,
      competitor_gap, mvp_concept, gtm_strategy,
      opportunity, problem, market_fit, business_model, value_prop,
      why_now, timing, community_signal, proof_signals, keywords,
      category, source,
      score_opportunity, score_feasibility, score_novelty, score_timing, score_market_fit,
      tags, is_unlocked
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )`,
    args: [
      id, idea.url, idea.sourceTitle, idea.title, idea.summary,
      JSON.stringify(idea.painPoints), idea.targetAudience,
      idea.competitorGap, idea.mvpConcept, idea.gtmStrategy,
      idea.opportunity, idea.problem, idea.marketFit, idea.businessModel, idea.valueProp,
      idea.whyNow, idea.timing, idea.communitySignal,
      JSON.stringify(idea.proofSignals), JSON.stringify(idea.keywords),
      idea.category, idea.source,
      idea.scores.opportunity, idea.scores.feasibility, idea.scores.novelty,
      idea.scores.timing, idea.scores.marketFit,
      JSON.stringify(idea.tags), opts.isUnlocked ? 1 : 0,
    ],
  });

  const rowResult = await db.execute({ sql: 'SELECT * FROM ideas WHERE id = ?', args: [id] });
  return formatIdea(rowResult.rows[0] as unknown as Record<string, unknown>);
}
