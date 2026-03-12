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

Requires Node 22 (see `.nvmrc`) and, for anything touching the database, Docker Desktop.

```bash
npm install
npx supabase start           # local Postgres + Auth on ports 544xx, applies migrations
npm run dev:local            # http://localhost:3000 against the local stack
```

`npm run dev` uses `.env.local` instead (the hosted project; copy `.env.example`). Locally,
magic-link emails land in Mailpit at http://127.0.0.1:54424. To use the app locally, sign in,
then make yourself an admin and let yourself in from `psql` / Studio (http://127.0.0.1:54423):

```sql
insert into public.app_admins (user_id) select id from auth.users where email = 'you@example.com';
update public.profiles set invited_at = now(), onboarding_step = greatest(onboarding_step, 2)
where email = 'you@example.com';
```

| Command                                                       | What it does                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks (CI runs all three)                                                  |
| `npm test`                                                    | Vitest unit + component tests                                                      |
| `npm run test:e2e`                                            | Playwright smoke tests against a production build (no database needed)             |
| `npm run test:e2e:local`                                      | All Playwright tests, including sign-in/invites/onboarding, against local Supabase |
| `npm run db:test:rls`                                         | Row Level Security + invite tests with real user sessions (local Supabase only)    |
| `npm run db:reset:local`                                      | Rebuild the local database from `supabase/migrations/`                             |
| `npm run db:types`                                            | Regenerate `lib/supabase/database.types.ts` from the local schema                  |
| `npm run worker`                                              | One watcher run locally; skips with a warning if Supabase env is missing           |

Run `npx playwright install chromium` once before the E2E commands.

The watcher runs in GitHub Actions every 30 minutes (`.github/workflows/watch.yml`) and needs the
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` repository secrets. Database changes go through
`supabase/migrations/` and the Supabase CLI (`npx supabase …`, a dev dependency); `npm run db:push`
applies them to the hosted project.

Planning docs and the coding-agent brief live outside this repo.
