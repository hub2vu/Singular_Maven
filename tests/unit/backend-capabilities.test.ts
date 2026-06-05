import { describe, expect, it } from "vitest";
import { backendCompatibility } from "../../scripts/native-host/backend-compatibility.mjs";
import { buildServer } from "../../src/backend/server.js";

describe("backend compatibility guard", () => {
  it("exposes the current Maven feature surface", async () => {
    const server = await buildServer({ mockLlm: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/capabilities" });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.service).toBe("dcinside-maven-copilot");
      expect(body.features).toContain("members.observe");
      expect(body.features).toContain("openai-oauth-proxy");
      expect(body.features).toContain("judge.model-select");
      expect(body.features).toContain("judge.uploaded-images");
      expect(body.features).toContain("images.list-title-brief");
    } finally {
      await server.close();
    }
  });

  it("rejects a stale backend that has health but no capabilities endpoint", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true, service: "dcinside-maven-copilot" }), { status: 200 });
      }
      if (url.endsWith("/api/capabilities")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("unexpected", { status: 500 });
    };

    const result = await backendCompatibility("http://127.0.0.1:8787", fetchImpl);

    expect(result.ok).toBe(false);
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("stale backend");
  });
});
