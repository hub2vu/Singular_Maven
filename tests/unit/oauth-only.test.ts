import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/backend/server.js";

const originalEnv = { ...process.env };
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const jsonPath = path.join(repoRoot, "dcinside_manager_posts_thesingularity_2026-06-02.json");

function observationFixture() {
  return {
    url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=777777",
    title: "Fixture DCInside post",
    galleryId: "thesingularity",
    postNo: "777777",
    bodyText: "Observed body quote with policy risk.",
    comments: [{ id: "c1", author: "commenter", text: "@bot defense(3)", depth: 0 }],
    images: [],
    links: [],
    clickableLabels: [],
    metadata: {}
  };
}

function restoreEnv() {
  process.env = { ...originalEnv };
}

describe("OpenAI OAuth-only auth", () => {
  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
  });

  it("does not expose API-key mode as a valid LLM credential", async () => {
    process.env.OPENAI_API_KEY = "sk-should-be-ignored";
    process.env.OPENAI_AUTH_MODE = "api_key";
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    const server = await buildServer({ mockLlm: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/auth/openai/status" });
      const body = response.json();

      expect(body.mode).toBe("openai-oauth-proxy");
      expect(body.apiKeyIgnored).toBe(true);
      expect(body).not.toHaveProperty("apiKeyConfigured");
    } finally {
      await server.close();
    }
  });

  it("reports local openai-oauth proxy status even when OPENAI_API_KEY is present", async () => {
    process.env.OPENAI_API_KEY = "sk-should-be-ignored";
    delete process.env.OPENAI_AUTH_MODE;
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    const server = await buildServer({ mockLlm: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/auth/openai/status" });
      const body = response.json();

      expect(body.mode).toBe("openai-oauth-proxy");
      expect(body.apiKeyIgnored).toBe(true);
      expect(body.autoStart).toBe(false);
      expect(body).toHaveProperty("proxyReady");
    } finally {
      await server.close();
    }
  });

  it("exposes only the DCInside Maven supported judge models and defaults to gpt-5.5", async () => {
    delete process.env.OPENAI_MODEL;
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    const server = await buildServer({ mockLlm: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/auth/openai/status" });
      const body = response.json();

      expect(body.model).toBe("gpt-5.5");
      expect(body.allowedModels).toEqual([
        "gpt-5.5",
        "gpt-5.5-mini",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.3-codex",
        "gpt-5.3-codex-spark",
        "gpt-5.2"
      ]);
    } finally {
      await server.close();
    }
  });

  it("rejects unsupported judge models before running a judgment", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/judge",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation: observationFixture(),
          model: "gpt-4.1-mini"
        })
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("model");
    } finally {
      await server.close();
    }
  });

  it("uses the selected judge model and stores it in the audit log", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";
    const tmp = await mkdtemp(path.join(tmpdir(), "maven-model-"));

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath, dataDir: tmp });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/judge",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation: observationFixture(),
          model: "gpt-5.3-codex-spark"
        })
      });
      const body = response.json();
      const auditPath = path.join(tmp, "audit", body.auditId.slice(0, 10), `${body.auditId}.json`);
      const audit = JSON.parse(await readFile(auditPath, "utf8"));

      expect(response.statusCode).toBe(200);
      expect(audit.model).toBe("gpt-5.3-codex-spark");
      expect(audit.llmInput.user).toContain("Model target: gpt-5.3-codex-spark");
    } finally {
      await server.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects uploaded-image judgment when the observed post has no images", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/judge/images",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation: observationFixture(),
          model: "gpt-5.5"
        })
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("No uploaded post images");
    } finally {
      await server.close();
    }
  });

  it("rejects uploaded-image judgment when an image source is the DCInside post page URL", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";
    const observation = {
      ...observationFixture(),
      images: [{
        src: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1226994&page=1",
        alt: "resolved empty image src",
        nearbyText: "본문 주변 문맥"
      }]
    };

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/judge/images",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation,
          model: "gpt-5.5"
        })
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("No uploaded post images");
    } finally {
      await server.close();
    }
  });

  it("judges only uploaded post images and omits ad-like images from audit input", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";
    const tmp = await mkdtemp(path.join(tmpdir(), "maven-image-"));
    const observation = {
      ...observationFixture(),
      images: [
        { src: "https://ads.example/banner.png", alt: "광고", nearbyText: "ad banner" },
        {
          src: "https://dcimg.example/uploaded-risk.png",
          alt: "업로드 이미지",
          nearbyText: "본문 주변 문맥",
          dataUrl: "data:image/png;base64,INLINE_IMAGE_BYTES"
        }
      ]
    };

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath, dataDir: tmp });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/judge/images",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation,
          model: "gpt-5.5",
          screenshotDataUrl: "data:image/png;base64,SCREENSHOT_SHOULD_NOT_BE_USED"
        })
      });
      const body = response.json();
      const auditPath = path.join(tmp, "audit", body.auditId.slice(0, 10), `${body.auditId}.json`);
      const audit = JSON.parse(await readFile(auditPath, "utf8"));

      expect(response.statusCode).toBe(200);
      expect(body.imageCount).toBe(1);
      expect(audit.attachedImageUrls).toEqual(["https://dcimg.example/uploaded-risk.png"]);
      expect(audit.attachedImageInputKinds).toEqual(["data-url"]);
      expect(audit.llmInput.user).toContain("uploaded post images only");
      expect(audit.llmInput.user).toContain("https://dcimg.example/uploaded-risk.png");
      expect(audit.llmInput.user).not.toContain("https://ads.example/banner.png");
      expect(JSON.stringify(audit)).not.toContain("INLINE_IMAGE_BYTES");
      expect(audit).not.toHaveProperty("screenshotPath");
      expect(JSON.stringify(audit)).not.toContain("SCREENSHOT_SHOULD_NOT_BE_USED");
    } finally {
      await server.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("re-downloads DCInside attachment URLs before judging uploaded images", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";
    const tmp = await mkdtemp(path.join(tmpdir(), "maven-image-redownload-"));
    const attachmentUrl = "https://image.dcinside.com/download.php?no=abc123&f_no=image.png";
    const observation = {
      ...observationFixture(),
      url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1226994&page=1",
      images: [{
        src: attachmentUrl,
        alt: "image.png",
        nearbyText: "원본 첨부파일 image.png",
        dataUrl: "data:image/png;base64,EXTENSION_INLINE_BYTES_SHOULD_NOT_BE_USED"
      }]
    };
    let requestedUrl = "";
    let requestedReferer = "";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      const headers = new Headers(init?.headers);
      requestedReferer = headers.get("referer") ?? "";
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" }
      });
    });

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath, dataDir: tmp });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/judge/images",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation,
          model: "gpt-5.5"
        })
      });
      const body = response.json();
      const auditPath = path.join(tmp, "audit", body.auditId.slice(0, 10), `${body.auditId}.json`);
      const audit = JSON.parse(await readFile(auditPath, "utf8"));

      expect(response.statusCode).toBe(200);
      expect(requestedUrl).toBe(attachmentUrl);
      expect(requestedReferer).toBe(observation.url);
      expect(audit.attachedImageUrls).toEqual([attachmentUrl]);
      expect(audit.attachedImageInputKinds).toEqual(["data-url"]);
      expect(JSON.stringify(audit)).not.toContain("EXTENSION_INLINE_BYTES_SHOULD_NOT_BE_USED");
    } finally {
      await server.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("loads extensionless DCInside viewimage URLs by sniffing image bytes", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";
    const tmp = await mkdtemp(path.join(tmpdir(), "maven-image-viewimage-"));
    const imageUrl = "https://dcimg8.dcinside.co.kr/viewimage.php?no=bodyimage123";
    const observation = {
      ...observationFixture(),
      url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1227710&page=1",
      images: [{
        src: imageUrl,
        alt: "body upload",
        nearbyText: ""
      }]
    };
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" }
    }));

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath, dataDir: tmp });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/judge/images",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation,
          model: "gpt-5.5"
        })
      });
      const body = response.json();
      const auditPath = path.join(tmp, "audit", body.auditId.slice(0, 10), `${body.auditId}.json`);
      const audit = JSON.parse(await readFile(auditPath, "utf8"));

      expect(response.statusCode).toBe(200);
      expect(body.imageCount).toBe(1);
      expect(audit.attachedImageUrls).toEqual([imageUrl]);
      expect(audit.attachedImageInputKinds).toEqual(["data-url"]);
    } finally {
      await server.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("briefs images from a list-selected post without creating a moderation judgment card", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";
    const observation = {
      ...observationFixture(),
      title: "Photo briefing target",
      images: [{
        src: "https://dcimg.example/list-brief.png",
        alt: "list brief image",
        nearbyText: "original attachment",
        dataUrl: "data:image/png;base64,LIST_BRIEF_IMAGE_BYTES"
      }]
    };

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/images/brief",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation,
          model: "gpt-5.5"
        })
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.answer).toContain("mock image brief");
      expect(body.answer).toContain("Photo briefing target");
      expect(body.model).toBe("gpt-5.5");
      expect(body.imageCount).toBe(1);
      expect(body).not.toHaveProperty("card");
      expect(body.attachedImageUrls).toEqual(["https://dcimg.example/list-brief.png"]);
    } finally {
      await server.close();
    }
  });

  it("answers contextual follow-up questions with the current observation and latest card", async () => {
    process.env.OPENAI_OAUTH_AUTO_START = "0";
    const observation = {
      ...observationFixture(),
      title: "Fixture follow-up post",
      bodyText: "Observed body quote for follow-up."
    };

    const server = await buildServer({ mockLlm: true, policyPath: jsonPath });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/chat/context",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          observation,
          question: "이 글에서 제일 중요한 판단 근거가 뭐야?",
          card: {
            summary: "Previous card summary",
            llm_reasoning: "Previous reasoning"
          },
          auditId: "audit-context-test",
          model: "gpt-5.5",
          history: [{ role: "assistant", content: "이전 답변" }]
        })
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.answer).toContain("이 글에서 제일 중요한 판단 근거가 뭐야?");
      expect(body.answer).toContain("Fixture follow-up post");
      expect(body.model).toBe("gpt-5.5");
    } finally {
      await server.close();
    }
  });
});
