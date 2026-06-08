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

export interface AnalysisResult {
  ideas: Array<Omit<AnalyzedIdea, 'id' | 'isUnlocked' | 'createdAt'>>;
  noIdeasReason?: string;
}

// ─── Mock (ARGENS_MOCK=1) ─────────────────────────────────────────────────────

function mockResult(url: string, source: string): AnalysisResult {
  return {
    ideas: [
      {
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
        targetAudience: 'Engineering leads at 5–20-person product teams who run daily standups',
        competitorGap: 'Geekbot and Standuply automate the form but produce noisy Slack threads nobody reads. No tool combines structured async input with a digest that is actually worth reading.',
        mvpConcept: 'A Slack bot that prompts three questions at 9am, collects answers, and posts a single team digest at 9:05am. No dashboards, no integrations — just the bot and one daily digest.',
        gtmStrategy: 'Cold-email 50 engineering managers on LinkedIn who post about remote work. Post in relevant Slack communities.',
        opportunity: 'The async work market is accelerating post-pandemic with millions of remote-first teams still running synchronous standups out of habit.',
        problem: 'Teams lose hours each week to status-sharing rituals that exist only because there is no better system.',
        marketFit: 'Strong fit with remote-first engineering teams at growth-stage startups who value async culture but lack tooling.',
        businessModel: 'Per-seat SaaS at $5/seat/month. 10-person team = $50/month. First year target: 200 teams = $120k ARR.',
        valueProp: 'Replace your daily standup with a 60-second async digest that surfaces blockers, not just status.',
        whyNow: 'Remote work norms are permanent. Teams that adopted async during the pandemic are now codifying it into tooling.',
        timing: 'Ideal — remote-first is mainstream, async culture is established, but tooling is still primitive.',
        communitySignal: 'High discussion volume in r/remotework and Hacker News. Multiple "anyone know a good async standup tool?" posts per week.',
        proofSignals: [
          'Geekbot has 40k+ paying customers despite poor UX',
          '#remote-work channels in every major SaaS company Slack',
          'HN thread with 300+ comments on async standups',
        ],
        keywords: ['async standup', 'remote team tools', 'engineering productivity', 'team communication', 'slack bot'],
        category: 'productivity',
        scores: { opportunity: 79, feasibility: 93, novelty: 71, timing: 82, marketFit: 85 },
        tags: ['async work', 'team tools', 'productivity'],
      },
    ],
  };
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are OpHunt, an expert startup opportunity analyst. Given content from a URL or signal source, identify up to 3 genuinely distinct, buildable startup opportunities a solo founder could ship in 90 days.

CRITICAL QUALITY STANDARDS — read carefully before responding:
- Only include ideas with quality_confidence >= 65. Quality means: a clear unmet need backed by evidence in the source, an identifiable ICP, and a realistic solo-founder scope.
- Do NOT pad with weak or generic ideas. 1 strong idea is far better than 3 mediocre ones.
- If the source yields no viable opportunity, return an empty ideas array with a short no_ideas_reason. Be honest — do not manufacture ideas from thin air.
- Reject ideas that are: too vague to act on, already dominated by well-funded incumbents with no obvious wedge, pure content/SEO plays, or require a team of 5+ to ship.
- Each idea in the array must be meaningfully distinct — no variations of the same concept.

Return ONLY a raw JSON object — no markdown fences, no code blocks, no preamble. Start with { and end with }:

{
  "ideas": [
    {
      "quality_confidence": <integer 0-100, your honest assessment — be strict>,
      "sourceTitle": "Brief title of the source (10 words max)",
      "title": "Punchy startup idea title (5-8 words, no buzzwords)",
      "summary": "2-3 sentences. Lead with pain size. End with why now.",
      "painPoints": ["Specific pain 1", "Specific pain 2", "Specific pain 3"],
      "targetAudience": "Specific ICP: job title, company size, context that makes this painful",
      "competitorGap": "2-3 sentences on what existing solutions miss and why the gap is real",
      "mvpConcept": "3-4 sentences on the minimum viable product to validate in 90 days",
      "gtmStrategy": "3-4 sentences on first 100 customers. Name specific channels and tactics.",
      "opportunity": "2-3 sentences on market size and urgency",
      "problem": "2-3 sentences precisely defining the core problem",
      "marketFit": "2-3 sentences on why this solution fits this audience right now",
      "businessModel": "2-3 sentences on pricing, unit economics, path to $10k MRR",
      "valueProp": "One punchy sentence — what does the user get and why does it beat alternatives",
      "whyNow": "2-3 sentences on why this specific moment is right",
      "timing": "One sentence: early/ideal/late and why",
      "communitySignal": "1-2 sentences on forum posts, social signals showing the pain is real",
      "proofSignals": ["Signal 1 with data point", "Signal 2 with data point", "Signal 3 with data point"],
      "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
      "category": "one of: AI tools | dev tools | consumer apps | B2B SaaS | fintech | productivity | other",
      "scores": {
        "opportunity": <integer 0-100, market size and urgency>,
        "feasibility": <integer 0-100, buildable for a solo founder in 90 days>,
        "novelty": <integer 0-100, differentiated vs existing solutions>,
        "timing": <integer 0-100, how ideal is market timing right now>,
        "marketFit": <integer 0-100, how well solution fits this specific audience>
      },
      "tags": ["tag1", "tag2", "tag3"]
    }
  ],
  "no_ideas_reason": null
}

If there are no viable ideas, return: { "ideas": [], "no_ideas_reason": "Short honest explanation of why this source doesn't surface a buildable opportunity." }`;

// ─── Parse LLM response → AnalysisResult ─────────────────────────────────────

const QUALITY_THRESHOLD = 65;

function parseLlmResponse(
  text: string,
  url: string,
  source: string,
): AnalysisResult {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const p = JSON.parse(cleaned) as {
    ideas?: Record<string, unknown>[];
    no_ideas_reason?: string | null;
  };

  const rawIdeas = Array.isArray(p.ideas) ? p.ideas : [];
  const noIdeasReason = p.no_ideas_reason || undefined;

  const ideas = rawIdeas
    .filter(raw => {
      const confidence = Number(raw.quality_confidence) || 0;
      if (confidence < QUALITY_THRESHOLD) {
        console.log(`[analyze] Dropping idea "${raw.title}" — quality_confidence ${confidence} < ${QUALITY_THRESHOLD}`);
        return false;
      }
      return true;
    })
    .map(raw => {
      const scores = (raw.scores || {}) as Record<string, unknown>;
      return {
        url,
        source,
        sourceTitle: (raw.sourceTitle as string) || '',
        title: (raw.title as string) || 'Untitled Opportunity',
        summary: (raw.summary as string) || '',
        painPoints: (raw.painPoints as string[]) || [],
        targetAudience: (raw.targetAudience as string) || '',
        competitorGap: (raw.competitorGap as string) || '',
        mvpConcept: (raw.mvpConcept as string) || '',
        gtmStrategy: (raw.gtmStrategy as string) || '',
        opportunity: (raw.opportunity as string) || '',
        problem: (raw.problem as string) || '',
        marketFit: (raw.marketFit as string) || '',
        businessModel: (raw.businessModel as string) || '',
        valueProp: (raw.valueProp as string) || '',
        whyNow: (raw.whyNow as string) || '',
        timing: (raw.timing as string) || '',
        communitySignal: (raw.communitySignal as string) || '',
        proofSignals: (raw.proofSignals as string[]) || [],
        keywords: (raw.keywords as string[]) || [],
        category: CATEGORIES.includes(raw.category as Category) ? raw.category as Category : 'other',
        scores: {
          opportunity: Number(scores.opportunity) || 0,
          feasibility: Number(scores.feasibility) || 0,
          novelty: Number(scores.novelty) || 0,
          timing: Number(scores.timing) || 0,
          marketFit: Number(scores.marketFit) || 0,
        },
        tags: (raw.tags as string[]) || [],
      } satisfies Omit<AnalyzedIdea, 'id' | 'isUnlocked' | 'createdAt'>;
    });

  if (ideas.length === 0 && !noIdeasReason) {
    return {
      ideas: [],
      noIdeasReason: 'No opportunities met the quality threshold for this source.',
    };
  }

  return { ideas, noIdeasReason: ideas.length === 0 ? noIdeasReason : undefined };
}

// ─── Main analysis function ───────────────────────────────────────────────────

export async function analyzeContent(opts: {
  url: string;
  source?: string;
  rawContent?: string;
  rawTitle?: string;
}): Promise<AnalysisResult> {
  const source = opts.source || 'url';

  if (process.env.ARGENS_MOCK === '1') {
    console.log('[analyze] ARGENS_MOCK=1 — returning mock result');
    return mockResult(opts.url, source);
  }

  let pageContent = opts.rawContent || '';
  let pageTitle = opts.rawTitle || '';

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
    ? `URL: ${opts.url}\n\nPage title: ${pageTitle}\n\nContent:\n${pageContent.slice(0, 12000)}`
    : `URL: ${opts.url}\n\nNo content available. Analyze based on URL structure, domain, and path context.`;

  const text = await llmComplete(SYSTEM_PROMPT, userContent, 3500);
  return parseLlmResponse(text, opts.url, source);
}

// ─── Format DB row → AnalyzedIdea ─────────────────────────────────────────────

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

// ─── Persist a single idea to DB ──────────────────────────────────────────────

export async function persistIdea(
  db: Client,
  idea: Omit<AnalyzedIdea, 'id' | 'isUnlocked' | 'createdAt'>,
  opts: { isUnlocked?: boolean; sessionId?: string } = {},
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
      tags, is_unlocked, session_id
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
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
      opts.sessionId || '',
    ],
  });

  const row = await db.execute({ sql: 'SELECT * FROM ideas WHERE id = ?', args: [id] });
  return formatIdea(row.rows[0] as unknown as Record<string, unknown>);
}
