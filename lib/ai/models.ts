/**
 * Which model each provider uses per tier, and what it costs. Prices are list
 * prices per million tokens, standard tier, checked 2026-10-13:
 * - Anthropic: the claude-api skill's model table (platform.claude.com pricing).
 * - OpenAI: developers.openai.com/api/docs/pricing and /models ("If you're
 *   not sure where to start, use GPT-6 Astra"; GPT-6.1 Sol "balances
 *   intelligence and cost").
 * - Google: ai.google.dev/gemini-api/docs/pricing and /models (checked
 *   2026-10-14). gemini-2.5-flash, the handoff's pick, is now limited to
 *   projects that used it before, so a new key can't call it; Google's
 *   current Flash is gemini-3.8-flash. Paid prices below run through
 *   2026-12-31 and double on 2027-01-01. Without billing on the Google
 *   project there's a free tier instead (rate-limited, $0).
 * Update PRICES_CHECKED when these change; the cost explainer reads them.
 *
 * `strong` (edits) uses the same models and effort as `fast` on Anthropic
 * and OpenAI (Alex, 2026-10-14): a user pays for tailoring with their own
 * key, so the default is the cheaper model.
 *
 * Google splits them (Alex, 2026-10-16/17, Fix Handoff "shared key quota"):
 * keyword scoring and the edit step run on Flash; the second look, resume
 * import, company research and fact suggestions on Flash-Lite. Flash's free
 * quota is 20 requests a day per project (Flash-Lite's 500), so Flash is
 * kept for the two steps whose judgment shapes the score, the warnings and
 * the copy; the fast-tier steps are each checked in code or read-only.
 * Scoring was tried on Flash-Lite and didn't hold up (Design Decisions
 * "Which Gemini model runs which step"). The same split for a user's own
 * Gemini key: it's about which model suits which step, not whose key it is.
 */

import type { ProviderName, Tier } from "./types";

export const PRICES_CHECKED = "2026-10-14";

type Model = {
  id: string;
  label: string;
  /** USD per million tokens. */
  inputPerM: number;
  outputPerM: number;
};

export const MODELS: Record<ProviderName, Record<Tier, Model>> = {
  anthropic: {
    fast: {
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      inputPerM: 2,
      outputPerM: 10,
    },
    strong: {
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      inputPerM: 2,
      outputPerM: 10,
    },
  },
  openai: {
    fast: {
      id: "gpt-6.1-sol",
      label: "GPT-6.1 Sol",
      inputPerM: 2,
      outputPerM: 10,
    },
    strong: {
      id: "gpt-6.1-sol",
      label: "GPT-6.1 Sol",
      inputPerM: 2,
      outputPerM: 10,
    },
  },
  google: {
    fast: {
      id: "gemini-3.5-flash-lite",
      label: "Gemini 3.5 Flash-Lite",
      inputPerM: 0.3,
      outputPerM: 2.5,
    },
    strong: {
      id: "gemini-3.8-flash",
      label: "Gemini 3.8 Flash",
      inputPerM: 0.75,
      outputPerM: 3.75,
    },
  },
};

/**
 * The shared key's backup model (M8 §1, the "safety valve" in Design
 * Decisions "AI cost model"): Flash-Lite has its own free quota, separate
 * from Flash's. The fast tier runs on it anyway; the backup also moves
 * scoring and the edit step onto it for a tailoring Flash has already
 * turned away with a 429 or 503 (worker/tailor.ts).
 * gemini-3.5-flash-lite is Google's current stable Flash-Lite (there's no
 * 3.8 Flash-Lite for text); it has a free tier and takes the same
 * thinkingLevel values. Checked 2026-10-15 on ai.google.dev /models,
 * /pricing and /thinking. As a backup, only ever used on the shared key
 * (cost $0); a user's own key uses it as its fast tier (MODELS.google.fast).
 */
export const SHARED_BACKUP_MODEL: Model = {
  id: "gemini-3.5-flash-lite",
  label: "Gemini 3.5 Flash-Lite",
  inputPerM: 0.3,
  outputPerM: 2.5,
};

/**
 * Reasoning effort per tier. Both providers take the same names. The fast
 * tier copies and classifies (resume import), so it doesn't need deep
 * thought; medium keeps an import under about a minute.
 */
export const EFFORT: Record<Tier, "medium" | "high"> = {
  fast: "medium",
  strong: "medium",
};

export function costUsd(
  provider: ProviderName,
  tier: Tier,
  inputTokens: number,
  outputTokens: number,
): number {
  const model = MODELS[provider][tier];
  return (
    (inputTokens * model.inputPerM + outputTokens * model.outputPerM) /
    1_000_000
  );
}

/**
 * Rough token counts per step, for the cost explainer. Output includes the
 * model's reasoning, which is billed as output. Ranges, not promises: a long
 * posting or a two-page resume costs more.
 */
export const STEP_ESTIMATES = {
  /** One-time: resume file → structured resume. */
  import: [{ tier: "fast", input: 3_000, output: 4_000 }],
  /**
   * One tailored posting: keyword scoring and the edit on the strong model
   * (2026-10-17: scoring moved back from fast on Gemini), then the second
   * look on the fast one (M8): the posting plus the finished resume in, a
   * few short notes out.
   */
  tailor: [
    { tier: "strong", input: 8_000, output: 2_000 },
    { tier: "strong", input: 10_000, output: 4_000 },
    { tier: "fast", input: 5_000, output: 1_500 },
  ],
} as const satisfies Record<
  string,
  readonly { tier: Tier; input: number; output: number }[]
>;

export type Step = keyof typeof STEP_ESTIMATES;

/**
 * Low/high estimate for a step: the typical token counts, and twice that for
 * a long posting or a second one-page pass.
 */
export function estimateStep(
  provider: ProviderName,
  step: Step,
): { low: number; high: number } {
  const typical = STEP_ESTIMATES[step].reduce(
    (sum, part) => sum + costUsd(provider, part.tier, part.input, part.output),
    0,
  );
  return { low: typical, high: typical * 2 };
}

/**
 * What a call actually cost: nothing on the shared free key (Google's free
 * tier), list price otherwise. A user's own Gemini key may be on the free
 * tier too, but Shipmate can't tell, so it's counted at the paid price.
 */
export function callCostUsd(
  usage: { provider: ProviderName; inputTokens: number; outputTokens: number },
  tier: Tier,
  shared: boolean,
): number {
  if (shared) return 0;
  return costUsd(usage.provider, tier, usage.inputTokens, usage.outputTokens);
}

/** "$0.05" / "$0.16"; under a cent shows as "<$0.01". */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}
