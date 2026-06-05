import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backendCompatibility } from "./backend-compatibility.mjs";
import {
  openAIOAuthProxyBaseUrl,
  openAIOAuthProxyLaunchSpec,
  openAIOAuthProxyPort,
  openAIOAuthProxySubprocessEnv
} from "./oauth-proxy-command.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dataDir = path.join(repoRoot, "data");
mkdirSync(dataDir, { recursive: true });

function sendNativeMessage(payload) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

function portFromBackendUrl(backendUrl) {
  try {
    return new URL(backendUrl).port || "8787";
  } catch {
    return "8787";
  }
}

function startBackend(backendUrl) {
  const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxCli, "src/backend/server.ts"], {
    cwd: repoRoot,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: portFromBackendUrl(backendUrl)
    }
  });
  child.unref();
  return child.pid;
}

async function oauthProxyReady(port = openAIOAuthProxyPort()) {
  const baseUrl = openAIOAuthProxyBaseUrl(port);
  try {
    const response = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

function startOpenAIOAuthProxy(port = openAIOAuthProxyPort()) {
  const logPath = path.join(dataDir, "openai-oauth.log");
  const spec = openAIOAuthProxyLaunchSpec({ port, logPath, cwd: repoRoot });
  let logFd;
  try {
    const stdio = spec.stdio === "log-file"
      ? (logFd = openSync(logPath, "a"), ["ignore", logFd, logFd])
      : spec.stdio;
    const child = spawn(spec.file, spec.args, {
      cwd: repoRoot,
      detached: true,
      stdio,
      windowsHide: spec.windowsHide,
      env: openAIOAuthProxySubprocessEnv()
    });
    child.unref();
    return { pid: child.pid, proxyCommand: spec.proxyCommand, logPath };
  } finally {
    if (logFd !== undefined) closeSync(logFd);
  }
}

async function ensureOpenAIOAuthProxy() {
  const port = openAIOAuthProxyPort();
  const baseUrl = openAIOAuthProxyBaseUrl(port);
  const spec = openAIOAuthProxyLaunchSpec({ port });
  if (await oauthProxyReady(port)) {
    return { ok: true, proxyReady: true, started: false, baseUrl, oauthPort: port, proxyCommand: spec.proxyCommand };
  }

  const started = startOpenAIOAuthProxy(port);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await oauthProxyReady(port)) {
      return {
        ok: true,
        proxyReady: true,
        started: true,
        pid: started.pid,
        baseUrl,
        oauthPort: port,
        proxyCommand: started.proxyCommand,
        logPath: started.logPath
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    ok: false,
    proxyReady: false,
    started: true,
    pid: started.pid,
    baseUrl,
    oauthPort: port,
    proxyCommand: started.proxyCommand,
    logPath: started.logPath,
    reason: `openai-oauth did not become ready at ${baseUrl}. If login is required, run "npx @openai/codex login" manually, then retry.`
  };
}

async function waitForCompatibleBackend(backendUrl) {
  const deadline = Date.now() + 20_000;
  let lastError = "";
  while (Date.now() < deadline) {
    const compatibility = await backendCompatibility(backendUrl);
    if (compatibility.ok) {
      return compatibility;
    }
    lastError = compatibility.reason || "backend compatibility check failed";
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(lastError || "backend health timeout");
}

async function ensureBackend(message) {
  const backendUrl = typeof message.backendUrl === "string" ? message.backendUrl : "http://127.0.0.1:8787";
  const existing = await backendCompatibility(backendUrl);
  if (existing.ok) {
    return { ok: true, alreadyRunning: true, started: false, backendUrl, health: existing.health, capabilities: existing.capabilities };
  }
  if (existing.stale) {
    return {
      ok: false,
      stale: true,
      backendUrl,
      reason: `${existing.reason}. Restart the Maven backend so the extension can use /api/members/observe and GPT-img-style openai-oauth proxy auth.`
    };
  }

  const pid = startBackend(backendUrl);
  const checked = await waitForCompatibleBackend(backendUrl);
  return { ok: true, alreadyRunning: false, started: true, pid, backendUrl, health: checked.health, capabilities: checked.capabilities };
}

async function handle(message) {
  if (message?.type === "ensureBackend") {
    return ensureBackend(message);
  }
  if (message?.type === "ensureOpenAIOAuthProxy") {
    return ensureOpenAIOAuthProxy();
  }
  return { ok: false, reason: `Unknown native message type: ${message?.type}` };
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.length < 4) return;
  const length = buffer.readUInt32LE(0);
  if (buffer.length < 4 + length) return;
  const body = buffer.subarray(4, 4 + length).toString("utf8");
  Promise.resolve()
    .then(() => handle(JSON.parse(body)))
    .then((response) => sendNativeMessage(response))
    .catch((error) => sendNativeMessage({ ok: false, reason: String(error?.message || error) }))
    .finally(() => setTimeout(() => process.exit(0), 10));
});

process.stdin.resume();
