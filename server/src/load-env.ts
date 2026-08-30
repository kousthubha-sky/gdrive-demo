import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Node has a built-in .env parser since 20.12, so no dotenv dependency.
// Looked for next to the server package first, then at the repo root.
for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}
