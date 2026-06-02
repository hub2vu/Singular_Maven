import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const nativeManifest = {
  name: hostName,
  description: "Starts the local DCInside Maven Copilot backend and openai-oauth proxy.",
  path: hostCmdPath,
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
  hostCmdPath,
  installedFor: ["Google Chrome", "Chromium"]
}, null, 2));
