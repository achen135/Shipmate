-- Local and CI only (`supabase db reset` / a fresh `supabase start`); never
-- runs on production.
--
-- The AI key functions (save_api_key, sealed_api_key) need the server secret
-- in Vault. This is a fixed, public, local-only value; the same one is set
-- for the local app by scripts/with-local-supabase.mjs and for E2E by
-- playwright.config.ts. Production's is a random value Alex sets by hand.
select vault.create_secret(
  'local-only-api-key-server-secret-not-for-production',
  'api_key_server_secret'
);

-- The shared free Gemini key (shared_ai_key / worker_shared_ai_key). A fake,
-- public, local-only value: E2E sends Gemini calls to a mock that accepts
-- any key containing "e2e-valid". Production's is Alex's real key, added in
-- the dashboard.
select vault.create_secret(
  'AIza-local-only-e2e-valid-not-a-real-key',
  'shared_google_api_key'
);
