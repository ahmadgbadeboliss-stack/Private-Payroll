// Copy the compiled contract's proving keys / ZKIR / compiler metadata into
// the Vite build, mirroring the official Midnight examples where the UI build
// copies `keys/` and `zkir/` next to the app so FetchZkConfigProvider can
// serve them to the wallet from `<origin>/keys/...`.
//
// Runs as part of `npm run dev` and `npm run build`.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");

const managedDir = path.join(projectRoot, "contracts", "managed", "payroll");
const publicDir = path.join(projectRoot, "public");

if (!existsSync(managedDir)) {
  console.error("❌ contracts/managed/payroll not found. Run `npm run compile` first.");
  process.exit(1);
}

for (const dir of ["keys", "zkir", "compiler"]) {
  const src = path.join(managedDir, dir);
  const dest = path.join(publicDir, dir);
  if (!existsSync(src)) continue;
  mkdirSync(publicDir, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

console.log("✅ Copied contract assets (keys/, zkir/, compiler/) to public/");
