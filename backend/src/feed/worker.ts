/**
 * Curated idea-feed worker.
 * Gathers signals from HN, Reddit, Product Hunt, and tech RSS feeds,
 * runs each through the analysis engine, and persists scored ideas to the DB.
 *
 * Controlled by env:
 *   FEED_ENABLED=1              — enables the in-process scheduler
 *   FEED_INTERVAL_HOURS=24      — run interval (default: 24h)
 *   FEED_MAX_ITEMS_PER_RUN=15   — cap per run to bound Argens spend
 */

import type { Client } from '@libsql/client';
import { gatherFeedItems } from './sources.js';
import { analyzeContent, persistIdea } from '../analyze.js';
import { agentStatus } from '../argens.js';

const MAX_ITEMS = Number(process.env.FEED_MAX_ITEMS_PER_RUN) || 15;
const MIN_ALLOWANCE = 1.0; // USDC — stop if wallet allowance is below this

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runFeedOnce(db: Client): Promise<{ processed: number; skipped: number; errors: number }> {
  console.log('[feed] Starting feed run...');

  // Check wallet before spending
  try {
    const status = await agentStatus();
    const remaining = parseFloat(status.policies.allowance_remaining);
    if (remaining < MIN_ALLOWANCE) {
      console.warn(`[feed] Allowance too low (${remaining} USDC < ${MIN_ALLOWANCE}) — skipping run.`);
      return { processed: 0, skipped: 0, errors: 0 };
    }
    console.log(`[feed] Wallet READY. Allowance remaining: ${remaining} USDC`);
  } catch (err) {
    console.warn('[feed] Could not check wallet status — proceeding anyway:', err instanceof Error ? err.message : err);
  }

  // Gather raw signals
  const items = await gatherFeedItems(5);
  console.log(`[feed] Gathered ${items.length} raw items from sources.`);

  // Dedupe against existing URLs
  const existingUrls = new Set<string>();
  try {
    const rows = await db.execute('SELECT url FROM ideas WHERE url != \'\'');
    for (const row of rows.rows) {
      const r = row as unknown as Record<string, unknown>;
      if (r.url) existingUrls.add(r.url as string);
    }
  } catch (err) {
    console.warn('[feed] Could not load existing URLs for dedup:', err instanceof Error ? err.message : err);
  }

  const newItems = items.filter(item => item.url && !existingUrls.has(item.url));
  const toProcess = newItems.slice(0, MAX_ITEMS);
  console.log(`[feed] ${newItems.length} new items after dedup; processing up to ${MAX_ITEMS}.`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of toProcess) {
    try {
      const idea = await analyzeContent({
        url: item.url,
        source: item.source,
        rawContent: item.rawText,
        rawTitle: item.title,
      });
      await persistIdea(db, idea, { isUnlocked: false });
      processed++;
      console.log(`[feed] ✓ Persisted: "${idea.title}" (${idea.category}) from ${item.source}`);
    } catch (err) {
      errors++;
      console.error(`[feed] ✗ Failed to analyze "${item.title}":`, err instanceof Error ? err.message : err);
    }
  }

  skipped = newItems.length - toProcess.length;
  console.log(`[feed] Run complete — processed: ${processed}, skipped (cap): ${skipped}, errors: ${errors}`);
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

  // Run immediately on startup (after a short delay to let DB init finish)
  setTimeout(() => {
    runFeedOnce(db).catch(err => console.error('[feed] Initial run error:', err));
  }, 10_000);

  setInterval(() => {
    runFeedOnce(db).catch(err => console.error('[feed] Scheduled run error:', err));
  }, intervalMs);
}
