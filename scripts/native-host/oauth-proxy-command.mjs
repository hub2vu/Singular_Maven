import path from "node:path";

export const DEFAULT_OPENAI_OAUTH_PORT = 10531;

export function openAIOAuthProxyPort(env = process.env) {
  const raw = Number(env.OPENAI_OAUTH_PORT ?? DEFAULT_OPENAI_OAUTH_PORT);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_OPENAI_OAUTH_PORT;
}

export function openAIOAuthProxyBaseUrl(port = openAIOAuthProxyPort()) {
  return `http://127.0.0.1:${port}`;
}

export function openAIOAuthProxyCommand(port = openAIOAuthProxyPort()) {
  return `npx -y openai-oauth --port ${port}`;
}

function resolveNpx(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}

function resolveNpxCliPath(nodePath = process.execPath, env = process.env) {
  const npmExecPath = env.npm_execpath;
  if (npmExecPath && /[\\/]npx-cli\.js$/iu.test(npmExecPath)) return npmExecPath;
  if (npmExecPath && /[\\/]npm-cli\.js$/iu.test(npmExecPath)) {
    return npmExecPath.replace(/[\\/]npm-cli\.js$/iu, `${path.sep}npx-cli.js`);
  }
  return path.join(path.dirname(nodePath), "node_modules", "npm", "bin", "npx-cli.js");
}

function quotedForShell(value) {
  return `"${String(value).replace(/"/gu, "\\\"")}"`;
}

export function openAIOAuthProxyLaunchSpec({
  platform = process.platform,
  port = openAIOAuthProxyPort(),
  logPath = "openai-oauth.log",
  nodePath = process.execPath,
  npxCliPath = resolveNpxCliPath(nodePath)
} = {}) {
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

export function openAIOAuthProxySubprocessEnv(base = process.env) {
  const entries = [];
  for (const key of ["NO_PROXY", "no_proxy"]) {
    const value = base[key];
    if (value) entries.push(...String(value).split(",").map((part) => part.trim()).filter(Boolean));
  }
  for (const required of ["127.0.0.1", "localhost"]) {
    if (!entries.includes(required)) entries.push(required);
  }
  const noProxy = entries.join(",");
  return {
    ...base,
    NO_PROXY: noProxy,
    no_proxy: noProxy
  };
}
