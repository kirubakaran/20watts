/**
 * Lint the collection: `npm run lint` prints every finding and exits 1 on
 * errors. The same checks run in `npm test`; this is for reading them.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintCollection } from "../src/data/lint";
import type { Collection } from "../src/data/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const c = JSON.parse(await readFile(path.join(ROOT, "src/data/collection.json"), "utf8")) as Collection;
const findings = lintCollection(c.artworks);
for (const f of findings) console.log(`${f.level.padEnd(5)} ${f.id}  ${f.field}: ${f.message}`);
const errors = findings.filter((f) => f.level === "error").length;
console.log(`${findings.length} findings, ${errors} errors`);
process.exit(errors ? 1 : 0);
