/**
 * OpenAI implementation of AiProvider, written against OpenAI's current docs
 * (developers.openai.com, checked 2026-10-13): the Responses API with
 * Structured Outputs through `zodTextFormat` + `responses.parse`
 * (`output_parsed`), refusals as `refusal` content items, an `incomplete`
 * status when the output limit is hit, and the input-token counting
 * endpoint as the key test.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import type { ClientOptions } from "./anthropic";
import { toAiError } from "./errors";
import { EFFORT, MODELS } from "./models";
import {
  AiError,
  type AiProvider,
  type AiUsage,
  type StructuredRequest,
} from "./types";

export function createOpenAIProvider(options: ClientOptions): AiProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: options.fetch,
    timeout: options.timeoutMs ?? 240_000,
    maxRetries: options.maxRetries ?? 1,
  });
  const fail = (error: unknown) => toAiError(error, "openai", options.apiKey);

  return {
    name: "openai",

    async testKey() {
      try {
        await client.responses.inputTokens.count({
          model: MODELS.openai.fast.id,
          input: "Shipmate key check",
        });
      } catch (error) {
        throw fail(error);
      }
    },

    async generateStructured<T>(request: StructuredRequest<T>) {
      let response;
      try {
        response = await client.responses.parse({
          model: MODELS.openai[request.tier].id,
          instructions: request.system,
          input: request.input,
          max_output_tokens: request.maxOutputTokens ?? 16_000,
          reasoning: { effort: EFFORT[request.tier] },
          text: { format: zodTextFormat(request.schema, request.name) },
        });
      } catch (error) {
        throw fail(error);
      }

      const refused = response.output.some(
        (item) =>
          item.type === "message" &&
          item.content.some((part) => part.type === "refusal"),
      );
      if (refused) {
        throw new AiError(
          "refused",
          "OpenAI declined this request. Try again, or edit the file and retry.",
        );
      }
      if (response.status === "incomplete") {
        throw new AiError(
          "too_long",
          "The answer ran past its length limit. Try a shorter file.",
        );
      }
      if (response.output_parsed == null) {
        throw new AiError(
          "bad_output",
          "OpenAI's answer didn't match the expected format. Try again.",
        );
      }
      const usage: AiUsage = {
        provider: "openai",
        model: response.model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };
      return { data: response.output_parsed as T, usage };
    },
  };
}
