import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

const DEFAULT_OAUTH_PORT = 10531;
const DEFAULT_READY_TIMEOUT_MS = 2_500;
const DEFAULT_START_TIMEOUT_MS = 45_000;

export interface OpenAIOAuthProxyOptions {
  baseUrl?: string;
  port?: number;
  autoStart?: boolean;
  cwd?: string;
  logPath?: string;
  readyTimeoutMs?: number;
  startTimeoutMs?: number;
}

export interface OpenAIOAuthProxyStatus {
  mode: "openai-oauth-proxy";
  configured: boolean;
  proxyReady: boolean;
  baseUrl: string;
  oauthPort: number;
  autoStart: boolean;
  apiKeyIgnored: boolean;
  loginCommand: string;
  proxyCommand: string;
}

export interface OpenAIOAuthProxyLaunchSpec {
  file: string;
  args: string[];
  windowsHide: boolean;
  stdio: "ignore" | "log-file";
  proxyCommand: string;
}

function envFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return !/^(0|false|no|off)$/iu.test(value);
}

export function openAIOAuthPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.OPENAI_OAUTH_PORT ?? DEFAULT_OAUTH_PORT);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_OAUTH_PORT;
}

export function openAIOAuthAutoStart(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env.OPENAI_OAUTH_AUTO_START, true);
}

export function openAIOAuthBaseUrl(options: Pick<OpenAIOAuthProxyOptions, "baseUrl" | "port"> = {}): string {
  const baseUrl = options.baseUrl ?? process.env.OPENAI_OAUTH_BASE_URL;
  if (baseUrl) return baseUrl.replace(/\/+$/u, "");
  return `http://127.0.0.1:${options.port ?? openAIOAuthPort()}`;
}

function loopbackNoProxyValue(...existingValues: Array<string | undefined>): string {
  const parts = new Set(existingValues
    .flatMap((value) => (value ?? "").split(","))
    .map((part) => part.trim())
    .filter(Boolean));
  parts.add("127.0.0.1");
  parts.add("localhost");
  return [...parts].join(",");
}

export function openAIOAuthProxySubprocessEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const noProxy = loopbackNoProxyValue(base.NO_PROXY, base.no_proxy);
  return {
    ...base,
    NO_PROXY: noProxy,
    no_proxy: noProxy
  };
}

function defaultLogPath(cwd: string): string {
  return path.join(cwd, "data", "openai-oauth.log");
}

function resolveNpx(platform = process.platform): string {
  return platform === "win32" ? "npx.cmd" : "npx";
}

function resolveNpxCliPath(nodePath = process.execPath, env: NodeJS.ProcessEnv = process.env): string {
  const npmExecPath = env.npm_execpath;
  if (npmExecPath && /[\\/]npx-cli\.js$/iu.test(npmExecPath)) return npmExecPath;
  if (npmExecPath && /[\\/]npm-cli\.js$/iu.test(npmExecPath)) {
    return npmExecPath.replace(/[\\/]npm-cli\.js$/iu, `${path.sep}npx-cli.js`);
  }
  return path.join(path.dirname(nodePath), "node_modules", "npm", "bin", "npx-cli.js");
}

function quotedForShell(value: string): string {
  return `"${value.replace(/"/gu, "\\\"")}"`;
}

export function openAIOAuthProxyCommand(port = openAIOAuthPort()): string {
  return `npx -y openai-oauth --port ${port}`;
}

export function openAIOAuthProxyLaunchSpec({
  platform = process.platform,
  port = openAIOAuthPort(),
  logPath = defaultLogPath(process.cwd()),
  nodePath = process.execPath,
  npxCliPath = resolveNpxCliPath(nodePath)
}: {
  platform?: NodeJS.Platform;
  port?: number;
  logPath?: string;
  nodePath?: string;
  npxCliPath?: string;
} = {}): OpenAIOAuthProxyLaunchSpec {
  if (platform === "win32") {
    return {
      file: nodePath,
      args: [npxCliPath, "-y", "openai-oauth", "--port", String(port)],
      windowsHide: true,
      stdio: "log-file",
      proxyCommand: openAIOAuthProxyCommand(port)
    };
  }

  const command = `${resolveNpx(platform)} -y openai-oauth --port ${port} >> ${quotedForShell(logPath)} 2>&1`;
  return {
    file: "sh",
    args: ["-c", command],
    windowsHide: true,
    stdio: "ignore",
    proxyCommand: openAIOAuthProxyCommand(port)
  };
}

export async function checkOpenAIOAuthProxyReady(options: OpenAIOAuthProxyOptions = {}): Promise<boolean> {
  const baseUrl = openAIOAuthBaseUrl(options);
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function startOpenAIOAuthProxy(options: OpenAIOAuthProxyOptions = {}): ChildProcess {
  const cwd = options.cwd ?? process.cwd();
  const port = options.port ?? openAIOAuthPort();
  const logPath = options.logPath ?? defaultLogPath(cwd);
  mkdirSync(path.dirname(logPath), { recursive: true });

  const spec = openAIOAuthProxyLaunchSpec({ port, logPath });
  let logFd: number | undefined;
  try {
    let stdio: StdioOptions;
    if (spec.stdio === "log-file") {
      logFd = openSync(logPath, "a");
      stdio = ["ignore", logFd, logFd];
    } else {
      stdio = spec.stdio;
    }
    const child = spawn(spec.file, spec.args, {
      cwd,
      detached: true,
      windowsHide: spec.windowsHide,
      stdio,
      env: openAIOAuthProxySubprocessEnv()
    });
    child.unref();
    return child;
  } finally {
    if (logFd !== undefined) closeSync(logFd);
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureOpenAIOAuthProxy(options: OpenAIOAuthProxyOptions = {}): Promise<OpenAIOAuthProxyStatus> {
  const port = options.port ?? openAIOAuthPort();
  const autoStart = options.autoStart ?? openAIOAuthAutoStart();
  const baseUrl = openAIOAuthBaseUrl({ ...options, port });
  if (await checkOpenAIOAuthProxyReady({ ...options, baseUrl, port })) {
    return openAIOAuthProxyStatus({ ...options, baseUrl, port });
  }

  if (!autoStart) {
    throw new Error(`openai-oauth proxy is not ready at ${baseUrl}. Start it with "npx -y openai-oauth --port ${port}" or run "npx @openai/codex login" once if login is required.`);
  }

  startOpenAIOAuthProxy({ ...options, port });
  const deadline = Date.now() + (options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (await checkOpenAIOAuthProxyReady({ ...options, baseUrl, port, readyTimeoutMs: 2_000 })) {
      return openAIOAuthProxyStatus({ ...options, baseUrl, port });
    }
    await delay(500);
  }

  const logPath = options.logPath ?? defaultLogPath(options.cwd ?? process.cwd());
  throw new Error(`openai-oauth did not become ready at ${baseUrl}. Run "npx @openai/codex login" once, then retry. Proxy log: ${logPath}`);
}

export async function openAIOAuthProxyStatus(options: OpenAIOAuthProxyOptions = {}): Promise<OpenAIOAuthProxyStatus> {
  const port = options.port ?? openAIOAuthPort();
  const baseUrl = openAIOAuthBaseUrl({ ...options, port });
  const proxyReady = await checkOpenAIOAuthProxyReady({ ...options, baseUrl, port });
  return {
    mode: "openai-oauth-proxy",
    configured: proxyReady,
    proxyReady,
    baseUrl,
    oauthPort: port,
    autoStart: options.autoStart ?? openAIOAuthAutoStart(),
    apiKeyIgnored: Boolean(process.env.OPENAI_API_KEY),
    loginCommand: "npx @openai/codex login",
    proxyCommand: openAIOAuthProxyCommand(port)
  };
}
