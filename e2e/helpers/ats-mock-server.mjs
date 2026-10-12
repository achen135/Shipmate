/**
 * A stand-in for the Greenhouse job API during E2E (Tracker → Add by URL).
 * Playwright starts it next to the app; the app sends ATS calls here only
 * when E2E_ATS_ORIGIN is set and it's pointed at a local Supabase stack
 * (app/api/tracker/lookup/route.ts). Board "e2e-harbor" answers; anything
 * else is a 404, like a real unknown board.
 */

import { createServer } from "node:http";

const port = Number(process.env.ATS_MOCK_PORT ?? 3101);

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const job = url.pathname.match(/^\/v1\/boards\/e2e-harbor\/jobs\/(\d+)$/);
  if (url.pathname === "/") {
    response.writeHead(200).end("ok");
  } else if (job) {
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        id: Number(job[1]),
        title: `Mock Systems Intern ${job[1]}`,
        company_name: "Harbor Mock Co",
        location: { name: "Boston, MA" },
      }),
    );
  } else {
    response.writeHead(404, { "content-type": "application/json" }).end("{}");
  }
}).listen(port, () => console.log(`ATS mock on :${port}`));
