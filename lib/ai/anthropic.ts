/**
 * Anthropic implementation of AiProvider, written against the claude-api
 * skill (2026-10): structured output through `output_config.format` with the
 * SDK's zod helper and `messages.parse`, adaptive thinking (always on for
 * these models; depth set by `effort`), and the server-side refusal fallback
 * (`fallbacks: "default"`), which reruns a declined request on another model
 * inside the same call instead of failing it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { toAiError } from "./errors";
import { EFFORT, MODELS } from "./models";
import {
  AiError,
  type AiProvider,
  type AiUsage,
  type StructuredRequest,
} from "./types";

export type ClientOptions = {
  apiKey: string;
  /** E2E only: a local stand-in for the API (lib/e2e-origin.ts). */
  baseURL?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
};

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function createAnthropicProvider(options: ClientOptions): AiProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: options.fetch,
    timeout: options.timeoutMs ?? 240_000,
    maxRetries: options.maxRetries ?? 1,
  });
  const fail = (error: unknown) =>
    toAiError(error, "anthropic", options.apiKey);

  return {
    name: "anthropic",
    shared: false,

    async testKey() {
      try {
        // Token counting is free and needs a valid key with access to the
        // model, which is all a test has to prove.
        await client.messages.countTokens({
          model: MODELS.anthropic.fast.id,
          messages: [{ role: "user", content: "Shipmate key check" }],
        });
      } catch (error) {
        throw fail(error);
      }
    },

    async generateStructured<T>(request: StructuredRequest<T>) {
      let response;
      try {
        response = await client.beta.messages.parse({
          model: MODELS.anthropic[request.tier].id,
          max_tokens: request.maxOutputTokens ?? 16_000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          system: request.system,
          messages: [{ role: "user", content: request.input }],
          output_config: {
            effort: EFFORT[request.tier],
            format: betaZodOutputFormat(request.schema),
          },
        });
      } catch (error) {
        throw fail(error);
      }

      if (response.stop_reason === "refusal") {
        throw new AiError(
          "refused",
          "Anthropic declined this request. Try again, or edit the file and retry.",
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw new AiError(
          "too_long",
          "The answer ran past its length limit. Try a shorter file.",
        );
      }
      if (response.parsed_output == null) {
        throw new AiError(
          "bad_output",
          "Anthropic's answer didn't match the expected format. Try again.",
        );
      }
      const usage: AiUsage = {
        provider: "anthropic",
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
      return { data: response.parsed_output as T, usage };
    },
  };
}
