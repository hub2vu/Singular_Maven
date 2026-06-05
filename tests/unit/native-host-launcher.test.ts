import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function readRepoFile(...parts: string[]) {
  return readFileSync(path.join(repoRoot, ...parts), "utf8");
}

describe("native host hidden launcher", () => {
  it("installs a console-free launcher instead of the command shell wrapper on Windows", () => {
    const installer = readRepoFile("scripts", "install-native-host.mjs");

    expect(installer).toContain("MavenNativeHostLauncher.exe");
    expect(installer).toContain("native-host-launcher.json");
    expect(installer).toContain("/target:winexe");
    expect(installer).toMatch(/path:\s*nativeHostPath/u);
    expect(installer).not.toMatch(/path:\s*hostCmdPath/u);
  });

  it("bridges native messaging stdio while keeping the child process hidden", () => {
    const launcher = readRepoFile("scripts", "native-host", "hidden-launcher", "NativeHostLauncher.cs");

    expect(launcher).toContain("CreateNoWindow = true");
    expect(launcher).toContain("RedirectStandardInput = true");
    expect(launcher).toContain("RedirectStandardOutput = true");
    expect(launcher).toContain("Console.OpenStandardInput()");
    expect(launcher).toContain("Console.OpenStandardOutput()");
  });
});
