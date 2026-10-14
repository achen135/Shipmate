/**
 * A stand-in for the Greenhouse job API during E2E (Tracker → Add by URL).
 * Playwright starts it next to the app; the app sends ATS calls here only
 * when E2E_ATS_ORIGIN is set and it's pointed at a local Supabase stack
 * (app/api/tracker/lookup/route.ts). Board "e2e-harbor" answers; anything
 * else is a 404, like a real unknown board.
 *
 * Follows E2E: any board whose slug starts with "e2e-harbor" also lists its
 * jobs (GET /v1/boards/{slug}/jobs), with ids derived from the slug so two
 * test runs never share a job. One internship, one engineer role, and one
 * "Internal …" role, so the worker's title filter has something to drop.
 *
 * Review E2E: GET /v1/boards/e2e-harbor/jobs/{id}?questions=true also returns
 * an application form (the real Greenhouse shape, see lib/questions/
 * __fixtures__): standard questions, two written ones, and an anti-bot
 * puzzle.
 *
 * AI E2E (M6): POST /anthropic/v1/… and /openai/v1/… answer like the
 * Anthropic and OpenAI APIs (the app sends AI calls here when
 * E2E_AI_ORIGIN is set; lib/e2e-origin.ts). A key containing "e2e-valid"
 * is accepted; any other gets each API's real 401 body. Structured-output
 * requests get a faithful conversion built from the resume text itself:
 * Title Case / ALL CAPS lines become sections, as a careful model would.
 */

const field = (name, type, values = []) => ({ name, type, values });
const question = (label, required, fields, description = null) => ({
  label,
  required,
  description,
  fields,
});
const yesNo = [
  { label: "Yes", value: "1" },
  { label: "No", value: "0" },
];
const mockQuestions = [
  question("First Name", true, [field("first_name", "input_text")]),
  question("Last Name", true, [field("last_name", "input_text")]),
  question("Email", true, [field("email", "input_text")]),
  question("Phone", true, [field("phone", "input_text")]),
  question("Resume/CV", true, [
    field("resume", "input_file"),
    field("resume_text", "textarea"),
  ]),
  question("Are you legally authorized to work in the United States?", true, [
    field("question_1", "multi_value_single_select", yesNo),
  ]),
  question("Will you now or in the future require visa sponsorship?", true, [
    field("question_2", "multi_value_single_select", yesNo),
  ]),
  question("Why do you want to work at Harbor Mock?", true, [
    field("question_3", "textarea"),
  ]),
  question("Describe a project you are proud of.", false, [
    field("question_4", "textarea"),
  ]),
  question(
    "To show you are not a bot, decode this base64 string and enter the result: aGFyYm9y",
    true,
    [field("question_5", "input_text")],
  ),
];

import { createServer } from "node:http";

const port = Number(process.env.ATS_MOCK_PORT ?? 3101);

/**
 * Notifications E2E: stands in for a browser vendor's push service. The worker
 * (with E2E_PUSH_ORIGIN set) POSTs { endpoint, payload } to /push; a test reads
 * what a given subscription endpoint received with GET /push?endpoint=…
 */
const pushes = [];

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/push" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        pushes.push(JSON.parse(body));
        response.writeHead(201).end();
      } catch {
        response.writeHead(400).end();
      }
    });
    return;
  }
  if (url.pathname === "/push" && request.method === "GET") {
    const endpoint = url.searchParams.get("endpoint");
    const received = pushes.filter((p) => p.endpoint === endpoint);
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(received));
    return;
  }
  if (
    url.pathname.startsWith("/anthropic/") ||
    url.pathname.startsWith("/openai/")
  ) {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => answerAi(url, request, body, response));
    return;
  }
  const job = url.pathname.match(/^\/v1\/boards\/e2e-harbor\/jobs\/(\d+)$/);
  const board = url.pathname.match(/^\/v1\/boards\/(e2e-harbor[\w-]*)\/jobs$/);
  if (url.pathname === "/") {
    response.writeHead(200).end("ok");
  } else if (board) {
    const slug = board[1];
    let hash = 7;
    for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) % 90_000_000;
    const base = 900_000_000 + hash * 10;
    const published = new Date().toISOString();
    const make = (offset, title) => ({
      id: base + offset,
      title,
      absolute_url: `https://boards.greenhouse.io/${slug}/jobs/${base + offset}`,
      // The slug is in the location so a test can write a watch profile that
      // matches only its own board's jobs (tests run in parallel, and
      // matching is global).
      location: { name: `Boston, MA - ${slug}` },
      first_published: published,
      content: "&lt;p&gt;About the role &amp;amp; the team.&lt;/p&gt;",
    });
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        jobs: [
          make(1, "Software Engineer Intern"),
          make(2, "Staff Engineer"),
          make(3, "Internal Audit Manager"),
        ],
        meta: { total: 3 },
      }),
    );
  } else if (job) {
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        id: Number(job[1]),
        title: `Mock Systems Intern ${job[1]}`,
        company_name: "Harbor Mock Co",
        location: { name: "Boston, MA" },
        ...(url.searchParams.get("questions") === "true"
          ? {
              questions: mockQuestions,
              location_questions: [],
              compliance: [],
              demographic_questions: null,
            }
          : {}),
      }),
    );
  } else {
    response.writeHead(404, { "content-type": "application/json" }).end("{}");
  }
}).listen(port, () => console.log(`ATS mock on :${port}`));

// ---------------------------------------------------------------- AI mock

const send = (response, status, body) =>
  response
    .writeHead(status, {
      "content-type": "application/json",
      "request-id": "req_e2e",
    })
    .end(JSON.stringify(body));

function headingLike(line) {
  const t = line.trim();
  const parts = t.split(/\s+/);
  if (parts.length > 4 || /[@|,.:;/()]|\d/.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  if (letters === letters.toUpperCase()) return true;
  return parts.every(
    (w) => /^(and|of|in|for|the|&)$/i.test(w) || /^[A-Z]/.test(w),
  );
}

/** A faithful structured resume from plain resume text. */
function convert(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const [name = "", ...rest] = lines;
  const email =
    rest.find((l) => /@/.test(l))?.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "";
  const sections = [];
  for (const line of rest) {
    if (headingLike(line)) {
      sections.push({
        title: line,
        layout: "entries",
        entries: [],
        lists: [],
        text: "",
      });
      continue;
    }
    const section = sections.at(-1);
    if (!section) continue;
    if (
      (line.includes(",") &&
        !/^[-•]/.test(line) &&
        section.entries.length === 0) ||
      /\d{4}$/.test(line)
    ) {
      const [heading, subheading = "", ...more] = line
        .split(",")
        .map((p) => p.trim());
      section.entries.push({
        heading,
        subheading,
        dates: more.join(", "),
        location: "",
        bullets: [],
      });
    } else if (section.entries.length) {
      section.entries.at(-1).bullets.push(line.replace(/^[-•]\s*/, ""));
    }
  }
  return { header: { name, email, phone: "", links: [] }, sections };
}

function answerAi(url, request, raw, response) {
  let body = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return send(response, 400, { error: { message: "bad json" } });
  }
  const anthropic = url.pathname.startsWith("/anthropic/");
  const key = anthropic
    ? (request.headers["x-api-key"] ?? "")
    : (request.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!String(key).includes("e2e-valid")) {
    return anthropic
      ? send(response, 401, {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        })
      : send(response, 401, {
          error: {
            message: `Incorrect API key provided: ${key}. You can find your API key at https://platform.openai.com/account/api-keys.`,
            type: "invalid_request_error",
            param: null,
            code: "invalid_api_key",
          },
        });
  }

  const input = anthropic
    ? String(body.messages?.[0]?.content ?? "")
    : String(body.input ?? "");
  const instructions = anthropic
    ? String(body.system ?? "")
    : String(body.instructions ?? "");
  const answer = () => {
    if (/true facts/.test(instructions)) {
      return { facts: [{ kind: "skill", text: "Figma", detail: "" }] };
    }
    const text = input.replace(/<\/?resume_text>/g, "");
    return convert(text);
  };

  if (url.pathname === "/anthropic/v1/messages/count_tokens") {
    return send(response, 200, { input_tokens: 12 });
  }
  if (url.pathname === "/anthropic/v1/messages") {
    return send(response, 200, {
      id: "msg_e2e",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: JSON.stringify(answer()) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 800, output_tokens: 600 },
    });
  }
  if (url.pathname === "/openai/v1/responses/input_tokens") {
    return send(response, 200, {
      object: "response.input_tokens",
      input_tokens: 12,
    });
  }
  if (url.pathname === "/openai/v1/responses") {
    return send(response, 200, {
      id: "resp_e2e",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: body.model,
      output: [
        {
          type: "message",
          id: "msg_e2e",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(answer()),
              annotations: [],
            },
          ],
        },
      ],
      usage: { input_tokens: 800, output_tokens: 600, total_tokens: 1400 },
    });
  }
  return send(response, 404, { error: { message: "not found" } });
}
