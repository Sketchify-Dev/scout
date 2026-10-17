import type { RouterConfig } from './config';

export interface BountyQuote {
  priceUsdc: string;
  responsesRequired: number;
  ttlSeconds: number;
  rationale: string;
  source: 'stub' | 'agentrouter';
}

export interface ConsensusVerdict {
  consensusIndices: number[];
  confidenceBps: number;
  summary: string;
  source: 'stub' | 'agentrouter';
}

/**
 * The brain of the agent. Implementations answer two questions: what should
 * this bounty cost and look like, and do these human answers agree.
 *
 * The stub is the default. It is deterministic, free, and always available,
 * which also makes it the fallback when the hosted LLM is unreachable (for
 * example outside an off-peak API window). Nothing in the router depends on
 * which implementation is active.
 */
export interface Decider {
  quote(question: string): Promise<BountyQuote>;
  judge(question: string, answers: string[]): Promise<ConsensusVerdict>;
}

function normalize(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class StubDecider implements Decider {
  constructor(private readonly cfg: RouterConfig) {}

  async quote(question: string): Promise<BountyQuote> {
    void question;
    return {
      priceUsdc: this.cfg.defaultPriceUsdc,
      responsesRequired: this.cfg.defaultResponses,
      ttlSeconds: this.cfg.defaultTtlSeconds,
      rationale: 'StubDecider: flat demo pricing. No LLM call was made.',
      source: 'stub',
    };
  }

  async judge(question: string, answers: string[]): Promise<ConsensusVerdict> {
    void question;
    const groups = new Map<string, number[]>();
    answers.forEach((answer, index) => {
      const key = normalize(answer);
      const group = groups.get(key);
      if (group) group.push(index);
      else groups.set(key, [index]);
    });
    let best: number[] = [];
    for (const group of groups.values()) {
      if (group.length > best.length) best = group;
    }
    const total = answers.length;
    // No majority, no consensus. Paying a lone answer as truth would be dishonest,
    // so a split field returns empty and the escrow refunds the requester.
    const consensusIndices = best.length >= 2 ? [...best].sort((a, b) => a - b) : [];
    const confidenceBps =
      consensusIndices.length === 0 ? 0 : Math.round((best.length / total) * 10000);
    return {
      consensusIndices,
      confidenceBps,
      summary: `StubDecider: ${best.length} of ${total} answers matched exactly after normalization.`,
      source: 'stub',
    };
  }
}

function toPrice(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.01 || n > 1) return fallback;
  return value;
}

function toCount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(32, Math.max(1, value));
}

function toTtl(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(7 * 86400, Math.max(3600, value));
}

function toIndices(value: unknown, count: number): number[] {
  if (!Array.isArray(value)) return [];
  const out = [
    ...new Set(
      value.filter(
        (v): v is number =>
          typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < count,
      ),
    ),
  ].sort((a, b) => a - b);
  return out.length >= 2 ? out : [];
}

function toConfidence(value: unknown, hasConsensus: boolean): number {
  if (!hasConsensus) return 0;
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(10000, Math.max(0, n));
}

/**
 * Hosted-LLM decider behind AgentRouter's OpenAI-compatible endpoint. Any
 * failure (bad key, off-peak window, timeout, bad JSON) falls back to the
 * stub, so a dead brain never kills a paid bounty. It degrades, loudly: the
 * returned `source` field always says which path ran.
 */
export class AgentRouterDecider implements Decider {
  private readonly fallback: StubDecider;

  constructor(
    private readonly cfg: RouterConfig,
    fallback?: StubDecider,
  ) {
    this.fallback = fallback ?? new StubDecider(cfg);
  }

  async quote(question: string): Promise<BountyQuote> {
    try {
      const parsed = await this.chat(
        'You price micro-bounties for human ground-truth tasks. Reply with JSON only: {"priceUsdc": "0.05", "responsesRequired": 3, "ttlSeconds": 86400, "rationale": "..."}. Prices are USDC between 0.01 and 1.00. Prefer 2 to 5 responses and a TTL between 1 hour and 7 days.',
        `Question: ${question}`,
      );
      return {
        priceUsdc: toPrice(parsed.priceUsdc, this.cfg.defaultPriceUsdc),
        responsesRequired: toCount(parsed.responsesRequired, this.cfg.defaultResponses),
        ttlSeconds: toTtl(parsed.ttlSeconds, this.cfg.defaultTtlSeconds),
        rationale:
          typeof parsed.rationale === 'string' ? parsed.rationale : 'AgentRouter quote.',
        source: 'agentrouter',
      };
    } catch {
      return this.fallback.quote(question);
    }
  }

  async judge(question: string, answers: string[]): Promise<ConsensusVerdict> {
    try {
      const parsed = await this.chat(
        'You judge whether human answers to a ground-truth question agree. Reply with JSON only: {"consensusIndices": [0, 2], "confidenceBps": 6667, "summary": "..."}. Indices refer to the answers array order. confidenceBps is 0 to 10000. Return an empty array with 0 confidence when nothing agrees.',
        `Question: ${question}\nAnswers:\n${answers.map((a, i) => `${i}: ${a}`).join('\n')}`,
      );
      const consensusIndices = toIndices(parsed.consensusIndices, answers.length);
      return {
        consensusIndices,
        confidenceBps: toConfidence(parsed.confidenceBps, consensusIndices.length > 0),
        summary: typeof parsed.summary === 'string' ? parsed.summary : 'AgentRouter verdict.',
        source: 'agentrouter',
      };
    } catch {
      return this.fallback.judge(question, answers);
    }
  }

  private async chat(system: string, user: string): Promise<Record<string, unknown>> {
    const key = this.cfg.agentRouterKey;
    const model = this.cfg.agentRouterModel;
    if (!key || !model) throw new Error('AgentRouter is not configured.');
    const base = this.cfg.agentRouterBaseUrl.replace(/\/+$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      throw new Error(`AgentRouter HTTP ${response.status}. Falling back to stub.`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('AgentRouter returned no content. Falling back to stub.');
    return JSON.parse(content) as Record<string, unknown>;
  }
}

/**
 * Anthropic-native brain (Brewkeg, and any gateway exposing POST /v1/messages
 * with the x-api-key header). Same contract as AgentRouterDecider: validated
 * JSON out, silent stub fallback on any failure.
 */
export class AnthropicDecider implements Decider {
  private readonly fallback: StubDecider;

  constructor(
    private readonly cfg: RouterConfig,
    fallback?: StubDecider,
  ) {
    this.fallback = fallback ?? new StubDecider(cfg);
  }

  async quote(question: string): Promise<BountyQuote> {
    try {
      const parsed = await this.chat(
        'You price micro-bounties for human ground-truth tasks. Reply with JSON only: {"priceUsdc": "0.05", "responsesRequired": 3, "ttlSeconds": 86400, "rationale": "..."}. Prices are USDC between 0.01 and 1.00. Prefer 2 to 5 responses and a TTL between 1 hour and 7 days.',
        `Question: ${question}`,
      );
      return {
        priceUsdc: toPrice(parsed.priceUsdc, this.cfg.defaultPriceUsdc),
        responsesRequired: toCount(parsed.responsesRequired, this.cfg.defaultResponses),
        ttlSeconds: toTtl(parsed.ttlSeconds, this.cfg.defaultTtlSeconds),
        rationale:
          typeof parsed.rationale === 'string' ? parsed.rationale : 'Hosted brain quote.',
        source: 'agentrouter',
      };
    } catch {
      return this.fallback.quote(question);
    }
  }

  async judge(question: string, answers: string[]): Promise<ConsensusVerdict> {
    try {
      const parsed = await this.chat(
        'You judge whether human answers to a ground-truth question agree. Reply with JSON only: {"consensusIndices": [0, 2], "confidenceBps": 6667, "summary": "..."}. Indices refer to the answers array order. confidenceBps is 0 to 10000. Return an empty array with 0 confidence when nothing agrees.',
        `Question: ${question}\nAnswers:\n${answers.map((a, i) => `${i}: ${a}`).join('\n')}`,
      );
      const consensusIndices = toIndices(parsed.consensusIndices, answers.length);
      return {
        consensusIndices,
        confidenceBps: toConfidence(parsed.confidenceBps, consensusIndices.length > 0),
        summary: typeof parsed.summary === 'string' ? parsed.summary : 'Hosted brain verdict.',
        source: 'agentrouter',
      };
    } catch {
      return this.fallback.judge(question, answers);
    }
  }

  private async chat(system: string, user: string): Promise<Record<string, unknown>> {
    const key = this.cfg.agentRouterKey;
    const model = this.cfg.agentRouterModel;
    if (!key || !model) throw new Error('Brain is not configured.');
    // Accept the base with or without a trailing /v1; the path adds its own.
    const base = this.cfg.agentRouterBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const response = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      throw new Error(`Brain HTTP ${response.status}. Falling back to stub.`);
    }
    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (body.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    if (!text.trim()) throw new Error('Brain returned no text. Falling back to stub.');
    return JSON.parse(text) as Record<string, unknown>;
  }
}

export function getDecider(cfg: RouterConfig): Decider {
  if (cfg.agentRouterKey) {
    if (cfg.brainProtocol === 'anthropic') return new AnthropicDecider(cfg);
    return new AgentRouterDecider(cfg);
  }
  return new StubDecider(cfg);
}
