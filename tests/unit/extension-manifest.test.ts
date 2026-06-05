import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("extension manifest permissions", () => {
  it("has stable screenshot capture permission for side-panel initiated captureVisibleTab", async () => {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "extension/manifest.json"), "utf8"));

    expect(manifest.permissions).toContain("activeTab");
    expect(manifest.host_permissions).toContain("<all_urls>");
  });

  it("has native messaging permission and a stable extension key for backend auto-start", async () => {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "extension/manifest.json"), "utf8"));

    expect(manifest.permissions).toContain("nativeMessaging");
    expect(manifest.key).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
