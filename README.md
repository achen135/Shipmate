# ShipMate

Your crewmate for internship season. ShipMate watches job sources every 30 minutes, matches new
postings to what you're looking for, can tailor your resume to each one with your own AI key,
and keeps a built-in application tracker. **It never submits anything for you**: you review,
then apply.

> Status: in development (invite-only).

## Stack

Next.js (TypeScript) on Vercel · Supabase (Postgres, Auth, Storage, RLS) · GitHub Actions worker ·
Playwright Chromium for PDFs · Web Push · Anthropic / OpenAI (bring your own key)

## Development

Requires Node 22 (see `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # optional: nothing needs it to build yet
npm run dev                  # http://localhost:3000
```

| Command                                                       | What it does                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks (CI runs all three)                                              |
| `npm test`                                                    | Vitest unit + component tests                                                  |
| `npm run test:e2e`                                            | Playwright against a production build (`npx playwright install chromium` once) |
| `npm run worker`                                              | One watcher run locally; skips with a warning if Supabase env is missing       |

The watcher runs in GitHub Actions every 30 minutes (`.github/workflows/watch.yml`) and needs the
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` repository secrets. Database changes go through
`supabase/migrations/` and the Supabase CLI (`npx supabase …`, a dev dependency).

Planning docs and the coding-agent brief live outside this repo.
