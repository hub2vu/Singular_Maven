import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const hostName = "com.dcinside_maven_copilot.backend";
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "extension", "manifest.json"), "utf8"));
const publicKeyDer = Buffer.from(manifest.key, "base64");
const digest = createHash("sha256").update(publicKeyDer).digest();
const alphabet = "abcdefghijklmnop";
let extensionId = "";
for (const byte of digest.subarray(0, 16)) {
  extensionId += alphabet[byte >> 4] + alphabet[byte & 15];
}

const nativeDir = path.join(repoRoot, "data", "native-host");
mkdirSync(nativeDir, { recursive: true });
const nativeManifestPath = path.join(nativeDir, `${hostName}.json`);
const hostCmdPath = path.join(repoRoot, "scripts", "native-host", "native-host.cmd");
const nativeHostScriptPath = path.join(repoRoot, "scripts", "native-host", "native-host.mjs");

function findNodeExe() {
  if (process.execPath && existsSync(process.execPath)) {
    return process.execPath;
  }
  const programFilesNode = "C:\\Program Files\\nodejs\\node.exe";
  if (process.platform === "win32" && existsSync(programFilesNode)) {
    return programFilesNode;
  }
  return "node";
}

function findCscExe() {
  const candidates = [
    process.env.CSC_EXE,
    "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
    "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not find csc.exe. Install .NET Framework developer tools or set CSC_EXE to a C# compiler path.");
}

function ensureWindowsNativeHostLauncher() {
  const launcherDir = path.join(nativeDir, "launcher");
  const launcherPath = path.join(launcherDir, "MavenNativeHostLauncher.exe");
  const launcherConfigPath = path.join(launcherDir, "native-host-launcher.json");
  const launcherSourcePath = path.join(repoRoot, "scripts", "native-host", "hidden-launcher", "NativeHostLauncher.cs");
  mkdirSync(launcherDir, { recursive: true });

  execFileSync(findCscExe(), [
    "/nologo",
    "/target:winexe",
    "/optimize+",
    `/out:${launcherPath}`,
    launcherSourcePath
  ], { cwd: repoRoot, stdio: "pipe" });

  writeFileSync(launcherConfigPath, JSON.stringify({
    nodePath: findNodeExe(),
    nativeHostScript: nativeHostScriptPath,
    workingDirectory: repoRoot
  }, null, 2), "utf8");

  return {
    nativeHostPath: launcherPath,
    launcherConfigPath,
    launcherSourcePath
  };
}

const nativeHostInstall = process.platform === "win32"
  ? ensureWindowsNativeHostLauncher()
  : { nativeHostPath: hostCmdPath };
const nativeHostPath = nativeHostInstall.nativeHostPath;
const nativeManifest = {
  name: hostName,
  description: "Starts the local DCInside Maven Copilot backend and openai-oauth proxy.",
  path: nativeHostPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`]
};
writeFileSync(nativeManifestPath, JSON.stringify(nativeManifest, null, 2), "utf8");

for (const browser of ["Google\\Chrome", "Chromium"]) {
  const key = `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${hostName}`;
  execFileSync("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", nativeManifestPath, "/f"], { stdio: "pipe" });
}

console.log(JSON.stringify({
  ok: true,
  hostName,
  extensionId,
  nativeManifestPath,
  nativeHostPath,
  hostCmdPath,
  launcherConfigPath: nativeHostInstall.launcherConfigPath,
  installedFor: ["Google Chrome", "Chromium"]
}, null, 2));
