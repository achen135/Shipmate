/**
 * The tailor workflow's entry point (tailor.yml): drain the tailoring queue
 * and print any edited copies, then exit. Started by the database through
 * workflow_dispatch the moment someone queues a tailoring (Spec: expect
 * about 30-90 seconds); the 30-minute Watch run drains the queue too.
 */

import { createClient } from "@supabase/supabase-js";

import { serviceRoleKeySources } from "@/lib/ai";
import { withE2eOrigin } from "@/lib/e2e-origin";
import { createPoliteFetch } from "@/lib/http";
import type { Database } from "@/lib/supabase/database.types";

import { formatWarning, loadWorkerConfig } from "./config";
import { createPrinter } from "./pdf";
import { drainTailorings } from "./tailor";

/** tailor.yml's timeout is 15 minutes; stop claiming well before it. */
const BUDGET_MS = 12 * 60 * 1000;

async function main(): Promise<number> {
  const result = loadWorkerConfig(process.env);
  if (!result.ok) {
    console.log(
      formatWarning(
        `missing ${result.missing.join(", ")}; skipping this run.`,
        process.env,
      ),
    );
    return 0;
  }
  const { supabaseUrl, serviceRoleKey } = result.config;
  const db = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const printer = createPrinter();
  try {
    const stats = await drainTailorings(db, {
      keys: serviceRoleKeySources(db),
      printer,
      fetch: withE2eOrigin(createPoliteFetch(), process.env),
      deadline: Date.now() + BUDGET_MS,
      warn: (message) => console.log(formatWarning(message, process.env)),
    });
    console.log(`[tailor] ${JSON.stringify(stats)}`);
    return 0;
  } finally {
    await printer.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      "[tailor] crashed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
    );
    process.exitCode = 1;
  },
);
