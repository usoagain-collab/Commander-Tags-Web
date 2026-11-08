// Runs a TypeScript script that imports app code through the "@/..." shortcut (like vitest.config.mts does).
// Usage: node --env-file=.env.local scripts/run-ts.mjs scripts/<name>.mts [args...]
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("Usage: node scripts/run-ts.mjs <script.mts> [args...]");
process.argv = [process.argv[0], script, ...args];
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } });
await jiti.import(pathToFileURL(resolve(script)).href);
