/**
 * Feed signal sources — one fetcher per platform.
 * Each returns { url, title, rawText, source } items for the analysis engine.
 */

export interface FeedItem {
  url: string;
  title: string;
  rawText: string;
  source: string;
}

// ─── Hacker News ──────────────────────────────────────────────────────────────
// Uses the free Firebase API — no key required.

async function fetchHN(maxItems = 10): Promise<FeedItem[]> {
  try {
    const topRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topIds = (await topRes.json()) as number[];

    // Prefer Show HN / Ask HN items — take first 50 and filter
    const candidates = topIds.slice(0, 50);
    const items: FeedItem[] = [];

    for (const id of candidates) {
      if (items.length >= maxItems) break;
      try {
        const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const item = await itemRes.json() as Record<string, unknown>;
        if (!item || item.type !== 'story' || !item.url && !item.text) continue;

        const title = (item.title as string) || '';
        const url = (item.url as string) || `https://news.ycombinator.com/item?id=${id}`;
        const text = (item.text as string) || '';
        const score = Number(item.score) || 0;

        if (score < 20) continue; // skip low-signal items

        items.push({ url, title, rawText: `${title}\n\n${text}`.trim(), source: 'hn' });
      } catch { /* skip item on error */ }
    }
    return items;
  } catch (err) {
    console.warn('[feed:hn] fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── Reddit ───────────────────────────────────────────────────────────────────
// Public JSON API — no key required. Set a descriptive UA.

const REDDIT_SUBS = ['startups', 'SaaS', 'Entrepreneur', 'SideProject', 'indiehackers'];

async function fetchReddit(maxItems = 8): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  for (const sub of REDDIT_SUBS) {
    if (items.length >= maxItems) break;
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=5`, {
        headers: { 'User-Agent': 'OpHunt/1.0 idea-discovery-bot' },
      });
      if (!res.ok) continue;
      const data = await res.json() as { data?: { children?: { data: Record<string, unknown> }[] } };
      for (const child of data.data?.children || []) {
        if (items.length >= maxItems) break;
        const post = child.data;
        if (!post || post.stickied || post.is_video) continue;
        const title = (post.title as string) || '';
        const selftext = (post.selftext as string) || '';
        const url = (post.url as string) || `https://reddit.com${post.permalink as string}`;
        if (!title) continue;
        items.push({ url, title, rawText: `r/${sub}: ${title}\n\n${selftext.slice(0, 3000)}`.trim(), source: 'reddit' });
      }
    } catch (err) {
      console.warn(`[feed:reddit] r/${sub} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return items;
}

// ─── Product Hunt ─────────────────────────────────────────────────────────────
// Requires PRODUCT_HUNT_TOKEN. Skips gracefully if unset.

async function fetchProductHunt(maxItems = 5): Promise<FeedItem[]> {
  const token = process.env.PRODUCT_HUNT_TOKEN;
  if (!token) return [];

  const query = `{
    posts(order: VOTES, first: ${maxItems}) {
      edges { node { name tagline description url topics { edges { node { name } } } } }
    }
  }`;

  try {
    const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { posts?: { edges?: { node: Record<string, unknown> }[] } } };
    return (data.data?.posts?.edges || []).map(e => {
      const node = e.node;
      const name = (node.name as string) || '';
      const tagline = (node.tagline as string) || '';
      const description = (node.description as string) || '';
      return {
        url: (node.url as string) || 'https://producthunt.com',
        title: name,
        rawText: `Product Hunt launch: ${name}\n\n${tagline}\n\n${description}`.trim(),
        source: 'producthunt',
      };
    });
  } catch (err) {
    console.warn('[feed:producthunt] fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── Tech news RSS feeds ──────────────────────────────────────────────────────
// TechCrunch + The Verge RSS — no key required.

const RSS_FEEDS = [
  { url: 'https://feeds.feedburner.com/TechCrunch/', source: 'techcrunch' },
  { url: 'https://www.theverge.com/rss/index.xml', source: 'theverge' },
];

function parseRssTitlesAndDesc(xml: string): { title: string; description: string; link: string }[] {
  const items: { title: string; description: string; link: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (/<title[^>]*><!\[CDATA\[([^\]]*)\]\]><\/title>|<title[^>]*>([^<]*)<\/title>/.exec(block) || [])[1] || (/<title[^>]*>([^<]*)<\/title>/.exec(block) || [])[1] || '';
    const desc = (/<description[^>]*><!\[CDATA\[([^\]]*)\]\]><\/description>|<description[^>]*>([^<]*)<\/description>/.exec(block) || [])[1] || '';
    const link = (/<link[^>]*>([^<]*)<\/link>/.exec(block) || [])[1] || '';
    if (title) items.push({ title: title.trim(), description: desc.slice(0, 500).trim(), link: link.trim() });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchTechNews(maxItems = 6): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  for (const feed of RSS_FEEDS) {
    if (items.length >= maxItems) break;
    try {
      const res = await fetch(feed.url, { headers: { 'User-Agent': 'OpHunt/1.0' } });
      if (!res.ok) continue;
      const xml = await res.text();
      for (const entry of parseRssTitlesAndDesc(xml)) {
        if (items.length >= maxItems) break;
        items.push({
          url: entry.link || feed.url,
          title: entry.title,
          rawText: `${entry.title}\n\n${entry.description}`.trim(),
          source: feed.source,
        });
      }
    } catch (err) {
      console.warn(`[feed:${feed.source}] fetch failed:`, err instanceof Error ? err.message : err);
    }
  }
  return items;
}

// ─── Aggregate all sources ────────────────────────────────────────────────────

export async function gatherFeedItems(maxPerSource = 5): Promise<FeedItem[]> {
  const [hn, reddit, ph, tech] = await Promise.all([
    fetchHN(maxPerSource),
    fetchReddit(maxPerSource),
    fetchProductHunt(maxPerSource),
    fetchTechNews(maxPerSource),
  ]);
  return [...hn, ...reddit, ...ph, ...tech];
}
