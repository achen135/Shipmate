import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
/** e2e/helpers/ats-mock-server.mjs: stands in for the Greenhouse API. */
const ATS_MOCK_PORT = 3101;

/**
 * E2E happy paths against a production build (`next start`), not `next dev`,
 * so what's tested is what Vercel serves. In CI the build already ran in an
 * earlier step; locally this builds first.
 */
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // Fail at the stuck step rather than at the whole-test timeout.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    // Mobile-first app: the phone viewport is the primary target.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: process.env.CI
        ? `npm run start -- --port ${PORT}`
        : `npm run build && npm run start -- --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // Only honoured against a local Supabase stack (tracker lookup route).
      env: {
        ...(process.env as Record<string, string>),
        E2E_ATS_ORIGIN: `http://localhost:${ATS_MOCK_PORT}`,
      },
    },
    {
      command: "node e2e/helpers/ats-mock-server.mjs",
      url: `http://localhost:${ATS_MOCK_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        ...(process.env as Record<string, string>),
        ATS_MOCK_PORT: String(ATS_MOCK_PORT),
      },
    },
  ],
});
