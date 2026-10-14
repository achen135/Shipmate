// @vitest-environment node
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAnthropicProvider } from "./anthropic";
import { sealApiKey } from "./crypto";
import { NoKeyError, getProvider, serviceRoleKeySource } from "./index";
import { createOpenAIProvider } from "./openai";
import { AiError } from "./types";

/**
 * The providers against a fake `fetch`: no network, no real key. Response
 * bodies follow each API's documented shapes (Anthropic Messages + count
 * tokens; OpenAI Responses + input token counting), including their error
 * bodies, so the SDKs parse them exactly as they would the real thing.
 */

type Call = { url: string; headers: Headers; body: Record<string, unknown> };

function fakeFetch(
  respond: (call: Call) => { status?: number; body: unknown },
) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const call: Call = {
      url: request.url,
      headers: request.headers,
      body: request.body ? await request.json() : {},
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "request-id": "req_1" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const ANTHROPIC_KEY = "sk-ant-api03-FAKEfakeFAKEfakeFAKEfake-7f3a";
const OPENAI_KEY = "sk-proj-FAKEfakeFAKEfakeFAKEfake-9c1e";

const Answer = z.object({ title: z.string(), count: z.number() });
const request = {
  tier: "fast" as const,
  system: "Return the answer.",
  input: "the material",
  schema: Answer,
  name: "answer",
};

function anthropicMessage(
  text: string,
  stop_reason = "end_turn",
  model = "claude-sonnet-5-5",
) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text },
    ],
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 120, output_tokens: 45 },
  };
}

function openaiResponse(
  content: unknown[],
  status = "completed",
  model = "gpt-6.1-sol",
) {
  return {
    id: "resp_1",
    object: "response",
    created_at: 1760000000,
    status,
    model,
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content,
      },
    ],
    usage: { input_tokens: 130, output_tokens: 50, total_tokens: 180 },
  };
}

/** Everything written to the console during a test. */
let logged: string[];
beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => String(a)).join(" "));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Anthropic provider", () => {
  it("tests a key with the free token count, sending the key only as x-api-key", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { input_tokens: 9 } }));
    await createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: impl,
    }).testKey();
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe("/v1/messages/count_tokens");
    expect(calls[0].body.model).toBe("claude-sonnet-5-5");
    expect(calls[0].headers.get("x-api-key")).toBe(ANTHROPIC_KEY);
    expect(JSON.stringify(calls[0].body)).not.toContain(ANTHROPIC_KEY);
  });

  it("asks for native structured output and returns it parsed, with usage", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: anthropicMessage('{"title":"Research","count":3}'),
    }));
    const result = await createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: impl,
    }).generateStructured(request);

    expect(result.data).toEqual({ title: "Research", count: 3 });
    expect(result.usage).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      inputTokens: 120,
      outputTokens: 45,
    });
    const body = calls[0].body as {
      output_config: { effort: string; format: { type: string } };
      fallbacks: unknown;
      system: string;
      messages: { content: string }[];
    };
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.effort).toBe("medium");
    expect(body.fallbacks).toBe("default");
    expect(calls[0].headers.get("anthropic-beta")).toContain(
      "server-side-fallback-2026-07-01",
    );
    expect(body.system).toBe("Return the answer.");
    expect(body.messages[0].content).toBe("the material");
  });

  it("reports the model that answered when a fallback served it", async () => {
    const { impl } = fakeFetch(() => ({
      body: anthropicMessage(
        '{"title":"x","count":1}',
        "end_turn",
        "claude-opus-4-8",
      ),
    }));
    const { usage } = await createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: impl,
    }).generateStructured(request);
    expect(usage.model).toBe("claude-opus-4-8");
  });

  it("a refusal or a cut-off answer is an AiError, never half-parsed data", async () => {
    for (const [stop, code] of [
      ["refusal", "refused"],
      ["max_tokens", "too_long"],
    ] as const) {
      const { impl } = fakeFetch(() => ({
        body: anthropicMessage('{"title":"x","count":1}', stop),
      }));
      await expect(
        createAnthropicProvider({
          apiKey: ANTHROPIC_KEY,
          fetch: impl,
        }).generateStructured(request),
      ).rejects.toMatchObject({ code });
    }
  });

  it("a rejected key: shows Anthropic's words, never the key, logs nothing", async () => {
    const { impl } = fakeFetch(() => ({
      status: 401,
      body: {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      },
    }));
    const error = await createAnthropicProvider({
      apiKey: ANTHROPIC_KEY,
      fetch: impl,
      maxRetries: 0,
    })
      .testKey()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: "invalid_key", status: 401 });
    expect((error as Error).message).toBe(
      'Anthropic didn\'t accept this key. Anthropic said: "invalid x-api-key"',
    );
    expect(JSON.stringify(error)).not.toContain(ANTHROPIC_KEY);
    expect(logged.join("\n")).not.toContain(ANTHROPIC_KEY);
  });

  it("no credit is its own message", async () => {
    const { impl } = fakeFetch(() => ({
      status: 400,
      body: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
        },
      },
    }));
    await expect(
      createAnthropicProvider({
        apiKey: ANTHROPIC_KEY,
        fetch: impl,
        maxRetries: 0,
      }).testKey(),
    ).rejects.toMatchObject({ code: "out_of_credit" });
  });
});

describe("OpenAI provider", () => {
  it("tests a key with input-token counting, sending the key only as a bearer token", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: { object: "response.input_tokens", input_tokens: 5 },
    }));
    await createOpenAIProvider({ apiKey: OPENAI_KEY, fetch: impl }).testKey();
    expect(new URL(calls[0].url).pathname).toBe("/v1/responses/input_tokens");
    expect(calls[0].body.model).toBe("gpt-6.1-sol");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${OPENAI_KEY}`);
    expect(JSON.stringify(calls[0].body)).not.toContain(OPENAI_KEY);
  });

  it("asks for a strict JSON schema and returns output_parsed, with usage", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: openaiResponse([
        {
          type: "output_text",
          text: '{"title":"Research","count":3}',
          annotations: [],
        },
      ]),
    }));
    const result = await createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: impl,
    }).generateStructured(request);
    expect(result.data).toEqual({ title: "Research", count: 3 });
    expect(result.usage).toEqual({
      provider: "openai",
      model: "gpt-6.1-sol",
      inputTokens: 130,
      outputTokens: 50,
    });
    const body = calls[0].body as {
      text: { format: { type: string; strict: boolean; name: string } };
      reasoning: { effort: string };
      instructions: string;
    };
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
      name: "answer",
    });
    expect(body.reasoning.effort).toBe("medium");
    expect(body.instructions).toBe("Return the answer.");
  });

  it("a refusal or an incomplete answer is an AiError", async () => {
    const refusal = fakeFetch(() => ({
      body: openaiResponse([{ type: "refusal", refusal: "I can't help." }]),
    }));
    await expect(
      createOpenAIProvider({
        apiKey: OPENAI_KEY,
        fetch: refusal.impl,
      }).generateStructured(request),
    ).rejects.toMatchObject({ code: "refused" });

    const cut = fakeFetch(() => ({
      body: {
        ...openaiResponse(
          [{ type: "output_text", text: '{"title":"Res', annotations: [] }],
          "incomplete",
        ),
        incomplete_details: { reason: "max_output_tokens" },
      },
    }));
    const error = await createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: cut.impl,
    })
      .generateStructured(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
  });

  it("a rejected key: OpenAI's masked echo of the key is redacted too, and nothing is logged", async () => {
    const { impl } = fakeFetch(() => ({
      status: 401,
      body: {
        error: {
          message: `Incorrect API key provided: ${OPENAI_KEY}. You can find your API key at https://platform.openai.com/account/api-keys.`,
          type: "invalid_request_error",
          param: null,
          code: "invalid_api_key",
        },
      },
    }));
    const error = (await createOpenAIProvider({
      apiKey: OPENAI_KEY,
      fetch: impl,
      maxRetries: 0,
    })
      .testKey()
      .catch((e: unknown) => e)) as AiError;
    expect(error.code).toBe("invalid_key");
    expect(error.message).toContain("Incorrect API key provided: [key].");
    expect(error.message).not.toContain("sk-proj");
    expect(logged.join("\n")).not.toContain(OPENAI_KEY);
  });

  it("insufficient_quota (a 429) means out of credit, not 'slow down'", async () => {
    const { impl } = fakeFetch(() => ({
      status: 429,
      body: {
        error: {
          message:
            "You exceeded your current quota, please check your plan and billing details.",
          type: "insufficient_quota",
          param: null,
          code: "insufficient_quota",
        },
      },
    }));
    await expect(
      createOpenAIProvider({
        apiKey: OPENAI_KEY,
        fetch: impl,
        maxRetries: 0,
      }).testKey(),
    ).rejects.toMatchObject({ code: "out_of_credit" });
  });
});

describe("getProvider", () => {
  const master = randomBytes(32);
  const env = {
    API_KEY_ENCRYPTION_KEY: master.toString("base64"),
  };
  const userId = "11111111-1111-4111-8111-111111111111";

  function fakeDb(row: unknown) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return { from: () => chain } as never;
  }

  it("decrypts the stored key and hands back a working client", async () => {
    const sealed = sealApiKey(
      OPENAI_KEY,
      { userId, provider: "openai" },
      master,
    );
    const { impl, calls } = fakeFetch(() => ({
      body: { object: "response.input_tokens", input_tokens: 5 },
    }));
    const provider = await getProvider(
      serviceRoleKeySource(fakeDb({ provider: "openai", ...sealed })),
      userId,
      { env, fetch: impl },
    );
    expect(provider.name).toBe("openai");
    await provider.testKey();
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it("no saved key is a NoKeyError", async () => {
    await expect(
      getProvider(async () => null, userId, { env }),
    ).rejects.toThrow(NoKeyError);
  });

  it("a key sealed for someone else won't open", async () => {
    const sealed = sealApiKey(
      OPENAI_KEY,
      { userId: "22222222-2222-4222-8222-222222222222", provider: "openai" },
      master,
    );
    await expect(
      getProvider(async () => ({ provider: "openai", ...sealed }), userId, {
        env,
      }),
    ).rejects.toThrow("can't be decrypted");
  });
});
