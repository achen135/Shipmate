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
 * `strong` (edits) uses the same models and effort as `fast` for now (Alex,
 * 2026-10-14): every user pays for tailoring with their own key, so the
 * default is the cheaper model. The two tiers stay separate so a later
 * "stronger model for edits" option has somewhere to attach.
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
      id: "gemini-3.8-flash",
      label: "Gemini 3.8 Flash",
      inputPerM: 0.75,
      outputPerM: 3.75,
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
   * One tailored posting: score + gap check on the fast model, the edit on
   * the strong one (M7), then the second look on the fast one (M8): the
   * posting plus the finished resume in, a few short notes out.
   */
  tailor: [
    { tier: "fast", input: 8_000, output: 2_000 },
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
