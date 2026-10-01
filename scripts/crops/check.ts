// data/crops/*.json 형식 검사 (DB 접근 없음): npm run crops:check
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCropDoc, type CropDoc } from "./schema";

const DIR = join(__dirname, "..", "..", "data", "crops");
let failed = false;
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const errors = validateCropDoc(JSON.parse(readFileSync(join(DIR, file), "utf8")) as CropDoc);
  if (errors.length) failed = true;
  console.log(errors.length ? `✗ ${file}\n  ${errors.join("\n  ")}` : `✓ ${file}`);
}
if (failed) process.exit(1);
