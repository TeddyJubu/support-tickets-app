import { defineConfig } from "@playwright/test";

// Browser tests against the built app (npm run build first). scripts/e2e-server.ts seeds a
// scratch data folder and starts `next start` on port 3399 with only the test allow-list of
// variables (scripts/test-env.ts): it doesn't get this process's environment or .env.local.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL: "http://localhost:3399", trace: "retain-on-failure" },
  webServer: {
    command: "node --no-warnings --import ./scripts/register-ts.mjs scripts/e2e-server.ts",
    url: "http://localhost:3399/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
