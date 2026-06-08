/**
 * Argens marketplace client.
 *
 * All AI (LLM) and scraping calls go through POST /marketplace/call.
 * Consumer checkout ($1 unlock) stays on LemonSqueezy — Argens is the spend side.
 *
 * Docs: https://argens.xyz/SKILL.md
 * Base URL (confirmed): https://api.argens.xyz/v1
 */

const getBaseUrl = () => process.env.ARGENS_API_BASE_URL || 'https://api.argens.xyz/v1';
const getApiKey = () => process.env.ARGENS_API_KEY || '';
const getLlmServiceId = () => process.env.ARGENS_LLM_SERVICE_ID || '';
const getScrapeServiceId = () => process.env.ARGENS_SCRAPE_SERVICE_ID || 'firecrawl_scrape';

// ─── Typed envelopes ──────────────────────────────────────────────────────────

export class ArgensError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ArgensError';
  }
}

interface AgentStatus {
  api_key_status: string;
  wallet_status: string;
  wallet_balance: string;
  policies: {
    allowance_limit: string;
    allowance_remaining: string;
    max_transaction_limit: string;
  };
  today_spend: string;
  today_transactions: number;
}

interface MarketplaceService {
  id: string;
  name: string;
  description: string;
  categories: string[];
  display_price: string;
  is_enabled: boolean;
  status: string;
  skill_url: string;
  endpoints: { id: string; label: string; method: string; path: string; price: string }[];
}

// ─── Internal fetch helper ─────────────────────────────────────────────────────

async function argensFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new ArgensError('ARGENS_API_KEY is not set', 'NO_API_KEY', false);
  }
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const body = await res.json() as Record<string, unknown>;

  if (res.status === 402) {
    const code = (body.code as string) || 'POLICY_BLOCKED';
    const reason = ((body.details as Record<string, unknown>)?.reason as string) || 'policy blocked';
    throw new ArgensError(`Argens policy blocked: ${reason}`, code, false);
  }

  if (res.status === 202) {
    // Pending approval — poll for result
    const txId = ((body.data as Record<string, unknown>)?.transaction_id as string);
    if (!txId) throw new ArgensError('Pending approval but no transaction_id', 'PENDING_NO_ID', false);
    return pollTransaction(txId);
  }

  if (!res.ok) {
    const code = (body.code as string) || `HTTP_${res.status}`;
    const msg = (body.error as string) || `Argens request failed (${res.status})`;
    // 5xx are transient; 4xx (except 402) are caller errors
    throw new ArgensError(msg, code, res.status >= 500);
  }

  return body;
}

// ─── Poll transaction until SUCCESS ───────────────────────────────────────────

async function pollTransaction(txId: string, maxAttempts = 30, intervalMs = 2000): Promise<unknown> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const body = await argensFetch(`/transactions/${txId}`) as Record<string, unknown>;
    const status = ((body.data as Record<string, unknown>)?.status as string);
    if (status === 'SUCCESS') return body;
    if (status === 'REJECTED' || status === 'FAILED') {
      throw new ArgensError(`Transaction ${txId} ${status}`, status, false);
    }
  }
  throw new ArgensError(`Transaction ${txId} did not settle in time`, 'POLL_TIMEOUT', false);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Health check — call on server boot to verify key + wallet readiness. */
export async function agentStatus(): Promise<AgentStatus> {
  const body = await argensFetch('/agent/status') as { data: AgentStatus };
  return body.data;
}

/** List marketplace services, optionally filtered by category. */
export async function discoverServices(category?: string): Promise<MarketplaceService[]> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  const body = await argensFetch(`/marketplace/services?${params}`) as { data: MarketplaceService[] };
  return body.data;
}

/**
 * Core marketplace call — routes through POST /marketplace/call.
 * service_id must be an endpoint id (endpoints[].id), NOT the provider id.
 * Retries up to 2 times with backoff for retryable upstream failures.
 */
export async function argensCall(
  serviceId: string,
  payload: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<unknown> {
  const body: Record<string, unknown> = { service_id: serviceId, payload };
  if (query) body.query = query;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      console.log(`[argens] Retrying call to ${serviceId} (attempt ${attempt + 1}/3)...`);
    }
    try {
      const res = await argensFetch('/marketplace/call', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Record<string, unknown>;
      return (res.data as Record<string, unknown>)?.result;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ArgensError) || !err.retryable) throw err;
    }
  }
  throw lastErr;
}

/**
 * Scrape a URL to markdown using the Argens Firecrawl integration.
 * Returns { markdown, title }.
 */
export async function scrapeUrl(url: string): Promise<{ markdown: string; title: string }> {
  const result = await argensCall(getScrapeServiceId(), { url, formats: ['markdown'] }) as Record<string, unknown>;
  // Firecrawl upstream: result.data.markdown / result.data.metadata.title
  const data = (result?.data ?? result) as Record<string, unknown>;
  const markdown = (data?.markdown as string) || '';
  const title = ((data?.metadata as Record<string, unknown>)?.title as string) || '';
  return { markdown, title };
}

/**
 * Call the configured LLM provider via Argens marketplace.
 * Payload shape is Anthropic-style messages API; the client handles both
 * Anthropic (content[0].text) and OpenAI (choices[0].message.content) response shapes.
 */
export async function llmComplete(
  systemPrompt: string,
  userContent: string,
  maxTokens = 2000,
): Promise<string> {
  const llmServiceId = getLlmServiceId();
  if (!llmServiceId) {
    throw new ArgensError(
      'ARGENS_LLM_SERVICE_ID is not set. Run GET /api/admin/argens/llm-providers to discover available providers, enable one in the Argens dashboard, then set the env var to its endpoint id.',
      'NO_LLM_SERVICE_ID',
      false,
    );
  }

  const result = await argensCall(llmServiceId, {
    model: process.env.ARGENS_LLM_MODEL || 'deepseek-chat',
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  }) as Record<string, unknown>;

  // Argens wraps provider responses in an extra `data` field for some providers (e.g. DeepSeek).
  // Unwrap one level if present, then check both Anthropic and OpenAI response shapes.
  const inner = (result as { data?: unknown })?.data ?? result;

  const anthropicText =
    (inner as { content?: { type: string; text: string }[] })?.content?.[0]?.text;
  if (anthropicText) return anthropicText;

  const openaiText =
    (inner as { choices?: { message: { content: string } }[] })?.choices?.[0]?.message?.content;
  if (openaiText) return openaiText;

  // Fallback: try root-level result.data or result.text as a raw string
  const fallback =
    ((result as Record<string, unknown>)?.data as string) ||
    ((result as Record<string, unknown>)?.text as string);
  if (typeof fallback === 'string') return fallback;

  throw new ArgensError(
    'Could not extract text from LLM response. Check ARGENS_LLM_SERVICE_ID and the provider skill file at https://argens.xyz/SKILL/{provider}.md',
    'UNPARSEABLE_LLM_RESPONSE',
    false,
  );
}
