// pnpm app: builds Stockwise when the source has changed since the last
// build, then serves it on this computer only and opens the browser.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const port = process.env.PORT || "3000";
const url = `http://localhost:${port}`;
// Node may resolve "localhost" to IPv6 while the server listens on IPv4, so poll the address itself.
const probe = `http://127.0.0.1:${port}`;

function newestMtime(p) {
  if (!existsSync(p)) return 0;
  const s = statSync(p);
  if (!s.isDirectory()) return s.mtimeMs;
  return readdirSync(p).reduce((max, name) => Math.max(max, newestMtime(path.join(p, name))), s.mtimeMs);
}

const buildId = path.join(root, ".next", "BUILD_ID");
const builtAt = existsSync(buildId) ? statSync(buildId).mtimeMs : 0;
const sourceAt = Math.max(
  ...["app", "components", "lib", "package.json", "next.config.js", "tsconfig.json"].map((p) => newestMtime(path.join(root, p))),
);

if (builtAt < sourceAt) {
  console.log("Building Stockwise (first run or code changed; about a minute)...");
  const build = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", port], { cwd: root, stdio: "inherit" });

function openBrowser() {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser launcher available: the URL is printed below.
  }
}

// Wait until the server answers, then point the user at it.
const started = Date.now();
const poll = setInterval(async () => {
  try {
    await fetch(probe);
    clearInterval(poll);
    console.log(`\n  Stockwise is running at ${url}  (Ctrl+C to stop)\n`);
    if (!process.env.STOCKWISE_NO_BROWSER) openBrowser();
  } catch {
    if (Date.now() - started > 60_000) clearInterval(poll);
  }
}, 500);

const stop = () => server.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
