// Builds the Chrome extension into extension/dist (load it unpacked from
// there: chrome://extensions → Developer mode → Load unpacked).
//   npm run build:extension
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["background", "content", "popup", "options"].map((name) =>
    join(here, "src", `${name}.ts`),
  ),
  outdir: out,
  bundle: true,
  format: "iife",
  target: "chrome120",
  alias: { "@": join(here, "..") },
  logLevel: "warning",
  legalComments: "none",
});
await cp(join(here, "static"), out, { recursive: true });
console.log(`Shipmate Autofill built in ${out}`);
