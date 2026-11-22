// Runs the Expo CLI with the dev backend's URL. `npx convex dev` writes ../backend/.env.local
// (VITE_CONVEX_URL, because the web app reads it); Expo only inlines EXPO_PUBLIC_* variables,
// so the same address is exposed under that name here. An EXPO_PUBLIC_CONVEX_URL that is
// already set (e.g. by EAS for a release) wins.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envFile = join(root, "..", "backend", ".env.local");
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
env.EXPO_PUBLIC_CONVEX_URL ||= env.VITE_CONVEX_URL;

const cli = join(root, "node_modules", "expo", "bin", "cli");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
