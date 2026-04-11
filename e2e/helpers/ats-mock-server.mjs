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

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
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
      location: { name: "Boston, MA" },
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
