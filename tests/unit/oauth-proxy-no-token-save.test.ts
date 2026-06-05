import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/backend/server.js";

const originalEnv = { ...process.env };

function restoreEnv() {
  process.env = { ...originalEnv };
}

describe("openai-oauth proxy auth surface", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("does not offer a manual bearer-token save endpoint", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";
    const server = await buildServer({ mockLlm: true });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/auth/openai/oauth-token",
        payload: { token: "oauth-local-test-token-abcdefghijklmnopqrstuvwxyz" }
      });

      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
