import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkOpenAIOAuthProxyReady,
  openAIOAuthProxyLaunchSpec,
  openAIOAuthProxyStatus,
  openAIOAuthProxySubprocessEnv
} from "../../src/backend/auth/openaiOAuthProxy.js";
import { makeOpenAIJudgeProvider, makeOpenAITextProvider } from "../../src/backend/judge/openaiProvider.js";

const originalEnv = { ...process.env };

function restoreEnv() {
  process.env = { ...originalEnv };
}

function validCardJson() {
  return JSON.stringify({
    summary: "test judgment",
    issue_types: [],
    matched_rules: [],
    llm_reasoning: "The current page observation and policy evidence were compared.",
    uncertainty: "low",
    false_positive_risk: "low",
    recommended_actions: [{ type: "보류", label: "human review", rationale: "read-only candidate" }],
    current_page_evidence: [{ quote: "observed body", location: "body" }],
    policy_evidence: [],
    special_bot_command_candidates: [],
    final_human_decision_required: true
  });
}

async function withHttpServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  test: (baseUrl: string) => Promise<void>
) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error?.message || error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    await test(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("openai-oauth local proxy integration", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("adds localhost and 127.0.0.1 to NO_PROXY for the spawned oauth proxy", () => {
    const env = openAIOAuthProxySubprocessEnv({
      NO_PROXY: "example.com",
      no_proxy: "internal.local"
    });

    expect(env.NO_PROXY).toContain("example.com");
    expect(env.NO_PROXY).toContain("127.0.0.1");
    expect(env.NO_PROXY).toContain("localhost");
    expect(env.no_proxy).toContain("internal.local");
    expect(env.no_proxy).toContain("127.0.0.1");
    expect(env.no_proxy).toContain("localhost");
    expect(env.NO_PROXY).toBe(env.no_proxy);
  });

  it("uses the local openai-oauth CLI directly on Windows to avoid npx spawning cmd.exe", () => {
    const spec = openAIOAuthProxyLaunchSpec({
      platform: "win32",
      port: 10531,
      nodePath: "C:\\node\\node.exe",
      openaiOauthCliPath: "C:\\repo\\node_modules\\openai-oauth\\dist\\cli.js"
    });

    expect(spec.file).toBe("C:\\node\\node.exe");
    expect(spec.args).toEqual(["C:\\repo\\node_modules\\openai-oauth\\dist\\cli.js", "--port", "10531"]);
    expect(spec.args.join(" ")).not.toContain("npx");
    expect(spec.args.join(" ")).not.toContain(".cmd");
    expect(spec.args.join(" ")).not.toContain("@openai/codex");
    expect(spec.stdio).toBe("log-file");
    expect(spec.windowsHide).toBe(true);
  });

  it("checks readiness through the local /v1/models endpoint", async () => {
    await withHttpServer((req, res) => {
      expect(req.url).toBe("/v1/models");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
    }, async (baseUrl) => {
      await expect(checkOpenAIOAuthProxyReady({ baseUrl })).resolves.toBe(true);
    });
  });

  it("reports proxy status without treating OPENAI_API_KEY as auth", async () => {
    process.env.OPENAI_API_KEY = "sk-ignored";
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    await withHttpServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    }, async (baseUrl) => {
      const status = await openAIOAuthProxyStatus({ baseUrl });

      expect(status).toMatchObject({
        mode: "openai-oauth-proxy",
        configured: true,
        proxyReady: true,
        autoStart: false,
        apiKeyIgnored: true
      });
    });
  });

  it("sends LLM judgment requests to /v1/chat/completions on the local oauth proxy", async () => {
    process.env.OPENAI_API_KEY = "sk-ignored";
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    let receivedPath = "";
    let receivedBody: any;
    let receivedAuthorization: string | string[] | undefined;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
        return;
      }
      receivedPath = req.url || "";
      receivedAuthorization = req.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: validCardJson() } }]
      }));
    }, async (baseUrl) => {
      const provider = makeOpenAIJudgeProvider({ baseUrl });
      const card = await provider({
        prompt: { system: "system prompt", user: "observed body" },
        model: "gpt-test",
        evidence: [],
        visionEnabled: false
      });

      expect(receivedPath).toBe("/v1/chat/completions");
      expect(receivedBody.model).toBe("gpt-test");
      expect(receivedBody.messages[0]).toMatchObject({ role: "system", content: "system prompt" });
      expect(receivedBody.response_format).toBeUndefined();
      expect(receivedAuthorization).toBeUndefined();
      expect(JSON.stringify(receivedBody)).toContain("observed body");
      expect(JSON.stringify(receivedBody)).not.toContain("sk-ignored");
      expect(card).toMatchObject({
        summary: "test judgment",
        final_human_decision_required: true
      });
    });
  });

  it("attaches uploaded post image URLs to vision judgment requests without using a page screenshot", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    let receivedBody: any;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: validCardJson() } }]
      }));
    }, async (baseUrl) => {
      const provider = makeOpenAIJudgeProvider({ baseUrl });
      await provider({
        prompt: { system: "system prompt", user: "judge uploaded images only" },
        model: "gpt-test",
        evidence: [],
        imageUrls: ["https://dcimg.example/uploaded-1.png", "https://dcimg.example/uploaded-2.jpg"],
        screenshotDataUrl: "data:image/png;base64,SCREENSHOT_SHOULD_BE_IGNORED",
        visionEnabled: true
      });

      const userContent = receivedBody.messages[1].content;
      expect(userContent).toEqual([
        { type: "text", text: "judge uploaded images only" },
        { type: "image_url", image_url: { url: "https://dcimg.example/uploaded-1.png" } },
        { type: "image_url", image_url: { url: "https://dcimg.example/uploaded-2.jpg" } }
      ]);
      expect(JSON.stringify(userContent)).not.toContain("SCREENSHOT_SHOULD_BE_IGNORED");
    });
  });

  it("sends data URL vision judgment inputs through the responses endpoint", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    let receivedPath = "";
    let receivedBody: any;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
        return;
      }
      receivedPath = req.url || "";
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        output_text: validCardJson()
      }));
    }, async (baseUrl) => {
      const provider = makeOpenAIJudgeProvider({ baseUrl });
      await provider({
        prompt: { system: "system prompt", user: "judge uploaded images only" },
        model: "gpt-test",
        evidence: [],
        imageUrls: ["data:image/png;base64,SU5MSU5FX0lNQUdFX0JZVEVT"],
        screenshotDataUrl: "data:image/png;base64,SCREENSHOT_SHOULD_BE_IGNORED",
        visionEnabled: true
      });

      expect(receivedPath).toBe("/v1/responses");
      expect(receivedBody.model).toBe("gpt-test");
      expect(receivedBody.instructions).toBe("system prompt");
      expect(receivedBody.temperature).toBeUndefined();
      expect(receivedBody.input).toEqual([{
        role: "user",
        content: [
          { type: "input_text", text: "judge uploaded images only" },
          { type: "input_image", image_url: "data:image/png;base64,SU5MSU5FX0lNQUdFX0JZVEVT" }
        ]
      }]);
      expect(JSON.stringify(receivedBody)).not.toContain("SCREENSHOT_SHOULD_BE_IGNORED");
    });
  });

  it("routes mixed data and HTTP vision inputs through the responses endpoint", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    let receivedPath = "";
    let receivedBody: any;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
        return;
      }
      receivedPath = req.url || "";
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        output_text: validCardJson()
      }));
    }, async (baseUrl) => {
      const provider = makeOpenAIJudgeProvider({ baseUrl });
      await provider({
        prompt: { system: "system prompt", user: "judge uploaded images only" },
        model: "gpt-test",
        evidence: [],
        imageUrls: [
          "data:image/png;base64,TUlYRUQtSU1BR0U=",
          "https://dcimg.example/uploaded-risk.png"
        ],
        visionEnabled: true
      });

      expect(receivedPath).toBe("/v1/responses");
      expect(receivedBody.temperature).toBeUndefined();
      const userContent = receivedBody.input[0].content;
      expect(userContent).toEqual([
        { type: "input_text", text: "judge uploaded images only" },
        { type: "input_image", image_url: "data:image/png;base64,TUlYRUQtSU1BR0U=" },
        { type: "input_image", image_url: "https://dcimg.example/uploaded-risk.png" }
      ]);
    });
  });

  it("parses streamed responses endpoint output for data URL vision judgments", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    let receivedBody: any;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.end([
        "event: response.created",
        "data: {\"type\":\"response.created\"}",
        "",
        "event: response.output_text.delta",
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: validCardJson() })}`,
        "",
        "event: response.completed",
        "data: {\"type\":\"response.completed\"}",
        "",
        ""
      ].join("\n"));
    }, async (baseUrl) => {
      const provider = makeOpenAIJudgeProvider({ baseUrl });
      const card = await provider({
        prompt: { system: "system prompt", user: "judge uploaded images only" },
        model: "gpt-test",
        evidence: [],
        imageUrls: ["data:image/png;base64,SU5MSU5FX0lNQUdFX0JZVEVT"],
        visionEnabled: true
      });

      expect(receivedBody.stream).toBe(true);
      expect(card).toMatchObject({
        summary: "test judgment",
        final_human_decision_required: true
      });
    });
  });

  it("sends contextual follow-up questions to the local oauth proxy as text chat", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    let receivedBody: any;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: "contextual answer" } }]
      }));
    }, async (baseUrl) => {
      const provider = makeOpenAITextProvider({ baseUrl });
      const answer = await provider({
        system: "system context",
        user: "current post plus question",
        model: "gpt-test",
        history: [{ role: "user", content: "previous question" }]
      });

      expect(answer).toBe("contextual answer");
      expect(receivedBody.model).toBe("gpt-test");
      expect(receivedBody.messages).toEqual([
        { role: "system", content: "system context" },
        { role: "user", content: "previous question" },
        { role: "user", content: "current post plus question" }
      ]);
    });
  });
});
