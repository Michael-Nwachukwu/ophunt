import type { Client } from '@libsql/client';
import { gatherFeedItems } from './sources.js';
import { analyzeContent, persistIdea } from '../analyze.js';
import { agentStatus } from '../argens.js';

const MAX_ITEMS = Number(process.env.FEED_MAX_ITEMS_PER_RUN) || 15;
const MIN_ALLOWANCE = 1.0;

// ─── Spam filter ──────────────────────────────────────────────────────────────

const SPAM_RE = /\b(top \d+|best \d+|review \d{4}|how to|ways to|things (you|to)|you need to know|ultimate guide|complete guide|step by step|\d+ tips|\d+ tricks|roundup)\b/i;

function isSpam(title: string): boolean {
  return SPAM_RE.test(title);
}

// ─── Title similarity dedup ───────────────────────────────────────────────────

function normalizeTitle(t: string): string[] {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeTitle(a));
  const setB = new Set(normalizeTitle(b));
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function isDuplicateIdea(title: string, existingTitles: string[]): boolean {
  return existingTitles.some(existing => jaccardSimilarity(title, existing) > 0.55);
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runFeedOnce(db: Client): Promise<{ processed: number; skipped: number; errors: number }> {
  console.log('[feed] Starting feed run...');

  try {
    const status = await agentStatus();
    const remaining = parseFloat(status.policies.allowance_remaining);
    if (!isNaN(remaining) && remaining < MIN_ALLOWANCE) {
      console.warn(`[feed] Allowance too low (${remaining} USDC < ${MIN_ALLOWANCE}) — skipping run.`);
      return { processed: 0, skipped: 0, errors: 0 };
    }
    console.log(`[feed] Wallet READY. Allowance remaining: ${isNaN(remaining) ? 'unlimited' : remaining + ' USDC'}`);
  } catch (err) {
    console.warn('[feed] Could not check wallet status — proceeding anyway:', err instanceof Error ? err.message : err);
  }

  const rawItems = await gatherFeedItems(6);
  console.log(`[feed] Gathered ${rawItems.length} raw items from sources.`);

  // Spam filter
  const cleanItems = rawItems.filter(item => {
    if (isSpam(item.title)) {
      console.log(`[feed] Spam filtered: "${item.title}"`);
      return false;
    }
    return true;
  });
  console.log(`[feed] ${cleanItems.length} items after spam filter (removed ${rawItems.length - cleanItems.length}).`);

  // URL dedup against DB
  const existingUrls = new Set<string>();
  const existingTitles: string[] = [];
  try {
    const rows = await db.execute("SELECT url, title FROM ideas WHERE url != ''");
    for (const row of rows.rows) {
      const r = row as unknown as Record<string, unknown>;
      if (r.url) existingUrls.add(r.url as string);
      if (r.title) existingTitles.push(r.title as string);
    }
  } catch (err) {
    console.warn('[feed] Could not load existing data for dedup:', err instanceof Error ? err.message : err);
  }

  const newItems = cleanItems.filter(item => {
    if (item.url && existingUrls.has(item.url)) return false;
    if (isDuplicateIdea(item.title, existingTitles)) {
      console.log(`[feed] Similarity dedup: "${item.title}"`);
      return false;
    }
    return true;
  });

  const toProcess = newItems.slice(0, MAX_ITEMS);
  console.log(`[feed] ${newItems.length} new items after dedup; processing up to ${MAX_ITEMS}.`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of toProcess) {
    try {
      const result = await analyzeContent({
        url: item.url,
        source: item.source,
        rawContent: item.rawText,
        rawTitle: item.title,
      });

      if (result.ideas.length === 0) {
        console.log(`[feed] No viable ideas from "${item.title}": ${result.noIdeasReason || 'quality gate'}`);
        skipped++;
        continue;
      }

      for (const idea of result.ideas) {
        await persistIdea(db, idea, { isUnlocked: false });
        console.log(`[feed] ✓ Persisted: "${idea.title}" (${idea.category}) from ${item.source}`);
        processed++;
        // Track for in-run similarity dedup
        existingTitles.push(idea.title);
      }
    } catch (err) {
      errors++;
      console.error(`[feed] ✗ Failed to analyze "${item.title}":`, err instanceof Error ? err.message : err);
    }
  }

  skipped += newItems.length - toProcess.length;
  console.log(`[feed] Run complete — processed: ${processed}, skipped: ${skipped}, errors: ${errors}`);
  return { processed, skipped, errors };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startFeedScheduler(db: Client): void {
  if (process.env.FEED_ENABLED !== '1') {
    console.log('[feed] Scheduler disabled (FEED_ENABLED != 1)');
    return;
  }

  const intervalHours = Number(process.env.FEED_INTERVAL_HOURS) || 24;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  console.log(`[feed] Scheduler started — will run every ${intervalHours}h`);

  setTimeout(() => {
    runFeedOnce(db).catch(err => console.error('[feed] Initial run error:', err));
  }, 10_000);

  setInterval(() => {
    runFeedOnce(db).catch(err => console.error('[feed] Scheduled run error:', err));
  }, intervalMs);
}
