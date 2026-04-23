/**
 * Which model each provider uses per tier, and what it costs. Prices are list
 * prices per million tokens, standard tier, checked 2026-10-13:
 * - Anthropic: the claude-api skill's model table (platform.claude.com pricing).
 * - OpenAI: developers.openai.com/api/docs/pricing and /models ("If you're
 *   not sure where to start, use GPT-6 Astra"; GPT-6.1 Sol "balances
 *   intelligence and cost").
 * Update PRICES_CHECKED when these change; the cost explainer reads them.
 *
 * `strong` (edits) uses the same models and effort as `fast` for now (Alex,
 * 2026-10-14): every user pays for tailoring with their own key, so the
 * default is the cheaper model. The two tiers stay separate so a later
 * "stronger model for edits" option has somewhere to attach.
 */

import type { ProviderName, Tier } from "./types";

export const PRICES_CHECKED = "2026-10-13";

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
   * One tailored posting (M7): score + gap check on the fast model, then the
   * edit on the strong one.
   */
  tailor: [
    { tier: "fast", input: 8_000, output: 2_000 },
    { tier: "strong", input: 10_000, output: 4_000 },
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

/** "$0.05" / "$0.16"; under a cent shows as "<$0.01". */
export function formatUsd(amount: number): string {
  if (amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}
