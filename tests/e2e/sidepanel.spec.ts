import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function observationFixture() {
  return {
    url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=777777",
    title: "Fixture DCInside post",
    galleryId: "thesingularity",
    postNo: "777777",
    head: "general",
    author: { name: "fixture-user", uid: "fixture123", ip: "118.235", raw: "fixture-user fixture123 118.235" },
    bodyText: "Observed body quote with policy risk.",
    htmlExcerpt: "",
    comments: [{
      id: "c1",
      author: "commenter",
      authorIdentity: { name: "commenter", ip: "223.39", raw: "commenter 223.39" },
      text: "@bot defense(3)",
      depth: 0
    }],
    images: [{ src: "https://dcimg.example/risk.png", alt: "risk capture", nearbyText: "near image" }],
    links: [],
    selectedText: "",
    viewportText: "Observed body quote with policy risk.",
    clickableLabels: [],
    metadata: {
      commentEmoticonDetections: [{
        names: ["갱생특갤콘", "comment-con"],
        primaryName: "갱생특갤콘",
        sourceHint: "comment-con",
        nearbyText: "comment[1] commenter @bot defense(3) emoticon:갱생특갤콘"
      }]
    },
    counts: { comments: "1" }
  };
}

function judgmentFixture(summary = "LLM judgment rendered") {
  return {
    summary,
    issue_types: ["policy-risk"],
    matched_rules: [{ rule_id: "post-1226405-bot-command", source_post_no: "1226405", title: "Bot command", excerpt: "defense(n)", relevance: 0.91, tags: ["bot_command"] }],
    llm_reasoning: "The current page quote was compared with the retrieved policy source post.",
    uncertainty: "low",
    false_positive_risk: "low",
    recommended_actions: [{ type: "hold", label: "human review", rationale: "final click remains human-only" }],
    current_page_evidence: [{ quote: "Observed body quote with policy risk.", location: "body" }],
    policy_evidence: [{ source_post_no: "1226405", quote: "defense(n)", rule_id: "post-1226405-bot-command" }],
    special_bot_command_candidates: ["@bot defense(3)"],
    final_human_decision_required: true
  };
}

function proxyStatus(configured = true) {
  return {
    configured,
    proxyReady: configured,
    mode: "openai-oauth-proxy",
    model: "gpt-5.5",
    allowedModels: [
      "gpt-5.5",
      "gpt-5.5-mini",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2"
    ],
    visionEnabled: false,
    apiKeyIgnored: true,
    autoStart: true,
    oauthPort: 10531,
    loginCommand: "npx @openai/codex login"
  };
}

test("side panel shows a judgment card with current-page and policy evidence", async ({ page }) => {
  await page.addInitScript(({ observation, judgment, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return {
            ok: true,
            observation,
            screenshotDataUrl: "data:image/png;base64,iVBORw0KGgo="
          };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select"] }), { status: 200 });
      }
      if (url.includes("/api/judge")) {
        window.judgeRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          auditId: "audit-test",
          card: judgment
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), judgment: judgmentFixture(), status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#judgeButton").click();

  await expect(page.getByText("LLM judgment rendered")).toBeVisible();
  await expect(page.getByText("Current page evidence")).toBeVisible();
  await expect(page.getByText("Policy evidence")).toBeVisible();
  await expect(page.getByText("1226405").first()).toBeVisible();
  await expect(page.getByText("final_human_decision_required: true")).toBeVisible();
});

test("side panel sends the selected judge model with the judgment request", async ({ page }) => {
  await page.addInitScript(({ observation, judgment, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return { ok: true, observation };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select"] }), { status: 200 });
      }
      if (url.includes("/api/judge")) {
        window.judgeRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          auditId: "audit-test",
          card: judgment
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), judgment: judgmentFixture("Selected model judgment"), status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#modelSelect").selectOption("gpt-5.5-mini");
  await page.locator("#judgeButton").click();

  await expect(page.getByText("Selected model judgment")).toBeVisible();
  await expect(page.locator("#authStatus")).toContainText("gpt-5.5-mini");
  const model = await page.evaluate(() => window.judgeRequestBody?.model);
  expect(model).toBe("gpt-5.5-mini");
});

test("side panel lets users add and remove forbidden emoticon names", async ({ page }) => {
  await page.addInitScript(({ status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async () => ({ ok: true })
    };
    window.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());

  await expect(page.locator("#forbiddenEmoticonList")).toContainText("갱생특갤콘");
  await page.locator("#forbiddenEmoticonInput").fill("정치인콘");
  await page.locator("#forbiddenEmoticonForm").getByRole("button", { name: "추가" }).click();
  await expect(page.locator("#forbiddenEmoticonList")).toContainText("정치인콘");

  await page.locator("[data-forbidden-emoticon-remove='갱생특갤콘']").click();
  await expect(page.locator("#forbiddenEmoticonList")).not.toContainText("갱생특갤콘");

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mavenForbiddenEmoticons") || "[]"));
  expect(stored).toEqual(["정치인콘"]);
});

test("side panel detects forbidden emoticons locally without LLM judge", async ({ page }) => {
  await page.addInitScript(({ observation, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return { ok: true, observation, screenshotDataUrl: "data:image/png;base64,SCREENSHOT_SHOULD_NOT_BE_SENT" };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select"] }), { status: 200 });
      }
      if (url.includes("/api/judge")) {
        window.localEmoticonJudgeCalls = (window.localEmoticonJudgeCalls || 0) + 1;
        return new Response(JSON.stringify({
          auditId: "unexpected-emoticon-judge",
          card: {
            summary: "Unexpected LLM path",
            issue_types: [],
            matched_rules: [],
            llm_reasoning: "",
            uncertainty: "high",
            false_positive_risk: "high",
            recommended_actions: [],
            current_page_evidence: [],
            policy_evidence: [],
            special_bot_command_candidates: [],
            final_human_decision_required: true
          }
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#emoticonJudgeButton").click();

  await expect(page.locator("#cardPanel")).toContainText("금지 이모티콘 발견");
  await expect(page.locator("#cardPanel")).toContainText("갱생특갤콘");
  await expect(page.locator("#cardPanel")).toContainText("comment[1]");
  const judgeCalls = await page.evaluate(() => window.localEmoticonJudgeCalls || 0);
  expect(judgeCalls).toBe(0);
});

test("side panel separates page, comment, comment-emoticon, and uploaded-image judgment", async ({ page }) => {
  await page.addInitScript(({ observation, pageJudgment, commentJudgment, emoticonJudgment, imageJudgment, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return {
            ok: true,
            observation,
            screenshotDataUrl: "data:image/png;base64,SCREENSHOT_SHOULD_NOT_BE_SENT"
          };
        }
        if (message.type === "MAVEN_INLINE_IMAGE_URLS") {
          window.inlineImageRequests = [...(window.inlineImageRequests || []), message];
          return {
            ok: true,
            images: message.images.map((image) => ({
              ...image,
              dataUrl: "data:image/png;base64,INLINE_UPLOAD_IMAGE"
            })),
            failures: []
          };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select", "judge.uploaded-images"] }), { status: 200 });
      }
      if (url.includes("/api/judge/images")) {
        const body = JSON.parse(String(options?.body || "{}"));
        window.imageJudgeRequestBody = body;
        return new Response(JSON.stringify({
          auditId: "audit-image-test",
          card: imageJudgment,
          imageCount: 1
        }), { status: 200 });
      }
      if (url.includes("/api/judge")) {
        const body = JSON.parse(String(options?.body || "{}"));
        if (body.observation?.metadata?.mavenJudgmentScope === "comment-emoticon-names-only") {
          window.emoticonJudgeRequestBody = body;
          return new Response(JSON.stringify({
            auditId: "audit-emoticon-test",
            card: emoticonJudgment
          }), { status: 200 });
        }
        if (!window.pageJudgeRequestBody) {
          window.pageJudgeRequestBody = body;
          return new Response(JSON.stringify({
            auditId: "audit-page-test",
            card: pageJudgment
          }), { status: 200 });
        }
        window.commentJudgeRequestBody = body;
        return new Response(JSON.stringify({
          auditId: "audit-comment-test",
          card: commentJudgment
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, {
    observation: observationFixture(),
    pageJudgment: judgmentFixture("Page-only judgment"),
    commentJudgment: {
      ...judgmentFixture("Comment-only judgment"),
      comment_thread_assessment: {
        fighting_likelihood: "medium",
        fighting_summary: "The thread has direct pushback and could escalate.",
        clique_likelihood: "medium",
        clique_summary: "Repeated personal references need human review.",
        nickname_mention_policy_risk: "low",
        clique_requires_human_review: true,
        clique_confidence: 0.76,
        clique_signals: [{
          signal_type: "personal_history_reference",
          severity: "medium",
          comment_indices: [1],
          user_keys: ["ip-name:223.39:commenter"],
          rationale: "References prior personal context."
        }],
        clique_fp_guardrails_applied: ["nickname_mention_only_is_not_clique"],
        per_user: [{
          user_key: "ip-name:223.39:commenter",
          display_name: "commenter",
          ip: "223.39",
          comment_indices: [1],
          role: "participant",
          risk_level: "watch",
          rationale: "Single commenter uses a bot-command-like phrase in a tense comment context.",
          evidence_quotes: ["@bot defense(3)"],
          clique_role: "participant",
          clique_risk_level: "medium",
          clique_rationale: "Potential personal-reference pattern, but not enough for high risk.",
          clique_evidence_quotes: [{
            comment_index: 1,
            speaker_user_key: "ip-name:223.39:commenter",
            quote: "@bot defense(3)",
            signal_type: "personal_history_reference",
            severity: "medium",
            why_it_matters: "Fixture verifies clique evidence rendering."
          }],
          clique_fp_exemptions: ["nickname_mention_only_is_not_clique"]
        }]
      }
    },
    imageJudgment: judgmentFixture("Uploaded image judgment"),
    emoticonJudgment: judgmentFixture("Comment emoticon judgment"),
    status: proxyStatus(true)
  });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#judgeButton").click();
  await expect(page.getByText("Page-only judgment")).toBeVisible();

  const pageBody = await page.evaluate(() => window.pageJudgeRequestBody);
  expect(pageBody.screenshotDataUrl).toBeUndefined();
  expect(pageBody.observation.comments).toEqual([]);
  expect(pageBody.observation.bodyText).toContain("Observed body quote");
  expect(JSON.stringify(pageBody.observation)).not.toContain("@bot defense");

  await page.locator("#commentJudgeButton").click();
  await expect(page.getByText("Comment-only judgment")).toBeVisible();
  const cardPanel = page.locator("#cardPanel");
  await expect(cardPanel).toContainText("댓글 싸움 여부");
  await expect(cardPanel).toContainText("medium");
  await expect(cardPanel).toContainText("댓글러별 판단");
  await expect(cardPanel).toContainText("commenter | ip:223.39");
  await expect(cardPanel).toContainText("watch");
  await expect(cardPanel).toContainText("친목/네임드화");
  await expect(cardPanel).toContainText("닉언 정책 리스크");
  await expect(cardPanel).toContainText("Repeated personal references");
  await expect(cardPanel).toContainText("personal_history_reference");

  const commentBody = await page.evaluate(() => window.commentJudgeRequestBody);
  expect(commentBody.screenshotDataUrl).toBeUndefined();
  expect(commentBody.observation.comments).toHaveLength(1);
  expect(commentBody.observation.comments[0].text).toBe("@bot defense(3)");
  expect(commentBody.observation.metadata.mavenJudgmentScope).toBe("comments-only");
  expect(commentBody.observation.metadata.commentAuthorGroups).toEqual([{
    user_key: "ip-name:223.39:commenter",
    display_name: "commenter",
    uid: "",
    ip: "223.39",
    comment_indices: [1]
  }]);
  expect(commentBody.observation.bodyText).toContain("COMMENT AUTHOR GROUPS");
  expect(commentBody.observation.bodyText).toContain("@bot defense(3)");
  expect(commentBody.observation.images).toEqual([]);

  await page.locator("#emoticonJudgeButton").click();
  await expect(cardPanel).toContainText("금지 이모티콘 발견");
  await expect(cardPanel).toContainText("갱생특갤콘");
  await expect(cardPanel).toContainText("comment[1]");

  const emoticonBody = await page.evaluate(() => window.emoticonJudgeRequestBody);
  expect(emoticonBody).toBeUndefined();

  await page.locator("#imageJudgeButton").click();
  await expect(page.getByText("Uploaded image judgment")).toBeVisible();

  const imageBody = await page.evaluate(() => window.imageJudgeRequestBody);
  const inlineRequests = await page.evaluate(() => window.inlineImageRequests);
  expect(imageBody.screenshotDataUrl).toBeUndefined();
  expect(inlineRequests.at(-1).images).toEqual([{ src: "https://dcimg.example/risk.png", alt: "risk capture", nearbyText: "near image" }]);
  expect(imageBody.observation.images).toEqual([{
    src: "https://dcimg.example/risk.png",
    alt: "risk capture",
    nearbyText: "near image",
    dataUrl: "data:image/png;base64,INLINE_UPLOAD_IMAGE"
  }]);
});

test("side panel falls back to backend image loading when extension inlining fails", async ({ page }) => {
  await page.addInitScript(({ observation, imageJudgment, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return { ok: true, observation };
        }
        if (message.type === "MAVEN_INLINE_IMAGE_URLS") {
          window.inlineImageRequestBody = message;
          return {
            ok: false,
            images: [],
            failures: [{ src: message.images[0].src, reason: "image fetch returned empty image bytes" }]
          };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select", "judge.uploaded-images"] }), { status: 200 });
      }
      if (url.includes("/api/judge/images")) {
        window.imageJudgeRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          auditId: "audit-image-backend-fallback",
          card: imageJudgment,
          imageCount: 1
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, {
    observation: observationFixture(),
    imageJudgment: judgmentFixture("Backend-loaded image judgment"),
    status: proxyStatus(true)
  });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#imageJudgeButton").click();
  await expect(page.getByText("Backend-loaded image judgment")).toBeVisible();

  const imageBody = await page.evaluate(() => window.imageJudgeRequestBody);
  expect(imageBody.observation.images).toEqual([{
    src: "https://dcimg.example/risk.png",
    alt: "risk capture",
    nearbyText: "near image"
  }]);
});

test("side panel briefs images from a visible list post title without judging the current page", async ({ page }) => {
  const listObservation = {
    ...observationFixture(),
    title: "Photo briefing target",
    postNo: "1227001",
    images: [{ src: "https://dcimg.example/list-brief.png", alt: "list brief image", nearbyText: "attachment row" }]
  };
  await page.addInitScript(({ observation, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_LIST_POST_BY_TITLE") {
          window.listBriefResolveMessage = message;
          return {
            ok: true,
            listPost: {
              title: message.title,
              url: observation.url,
              postNo: observation.postNo,
              hasImage: true
            },
            observation
          };
        }
        if (message.type === "MAVEN_INLINE_IMAGE_URLS") {
          window.listBriefInlineMessage = message;
          return {
            ok: true,
            images: message.images.map((image) => ({
              ...image,
              dataUrl: "data:image/png;base64,LIST_BRIEF_IMAGE"
            })),
            failures: []
          };
        }
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          window.activeObserveCalled = true;
          return { ok: false, reason: "active observation should not be used" };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select", "images.list-title-brief"] }), { status: 200 });
      }
      if (url.includes("/api/images/brief")) {
        window.listBriefRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          answer: "List image brief rendered.",
          model: "gpt-5.5",
          imageCount: 1
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: listObservation, status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#listImageTitleInput").fill("Photo briefing target");
  await page.locator("#listImageBriefForm").getByRole("button", { name: "브리핑" }).click();

  await expect(page.locator("#listImageBriefResult")).toContainText("List image brief rendered.");
  await expect(page.locator("#listImageBriefResult")).toContainText("images: 1");
  const activeObserveCalled = await page.evaluate(() => window.activeObserveCalled || false);
  const resolveMessage = await page.evaluate(() => window.listBriefResolveMessage);
  const requestBody = await page.evaluate(() => window.listBriefRequestBody);

  expect(activeObserveCalled).toBe(false);
  expect(resolveMessage.title).toBe("Photo briefing target");
  expect(requestBody.observation.images[0]).toMatchObject({
    src: "https://dcimg.example/list-brief.png",
    dataUrl: "data:image/png;base64,LIST_BRIEF_IMAGE"
  });
});

test("side panel keeps follow-up chat as a normal panel and lets list image briefing collapse", async ({ page }) => {
  await page.addInitScript(({ status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async () => ({ ok: true })
    };
    window.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());

  const contextPosition = await page.locator("#contextChatPanel").evaluate((element) => getComputedStyle(element).position);
  const contextInsideMain = await page.locator("#contextChatPanel").evaluate((element) => Boolean(element.closest("main")));
  expect(contextPosition).not.toBe("sticky");
  expect(contextInsideMain).toBe(true);

  await expect(page.locator("#listImageBriefBody")).toBeVisible();
  await expect(page.locator("#listImageBriefToggle")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#listImageBriefToggle").click();
  await expect(page.locator("#listImageBriefBody")).toBeHidden();
  await expect(page.locator("#listImageBriefToggle")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#listImageBriefToggle").click();
  await expect(page.locator("#listImageBriefBody")).toBeVisible();
});

test("side panel asks follow-up questions with the current page and judgment context", async ({ page }) => {
  await page.addInitScript(({ observation, judgment, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return { ok: true, observation };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select", "context.chat"] }), { status: 200 });
      }
      if (url.includes("/api/chat/context")) {
        window.contextChatRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          answer: "Follow-up answer with the same context.",
          model: "gpt-5.5"
        }), { status: 200 });
      }
      if (url.includes("/api/judge")) {
        window.contextSourceJudgeRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          auditId: "audit-chat-context",
          card: judgment
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), judgment: judgmentFixture("Context source judgment"), status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#judgeButton").click();
  await expect(page.getByText("Context source judgment")).toBeVisible();

  await page.locator("#contextQuestionInput").fill("이 판단에서 놓치기 쉬운 반례는?");
  await page.locator("#contextQuestionForm").getByRole("button", { name: "질문" }).click();

  await expect(page.locator("#contextChatMessages")).toContainText("이 판단에서 놓치기 쉬운 반례는?");
  await expect(page.locator("#contextChatMessages")).toContainText("Follow-up answer with the same context.");
  const requestBody = await page.evaluate(() => window.contextChatRequestBody);
  expect(requestBody.question).toBe("이 판단에서 놓치기 쉬운 반례는?");
  expect(requestBody.observation.title).toBe("Fixture DCInside post");
  expect(requestBody.card.summary).toBe("Context source judgment");
  expect(requestBody.auditId).toBe("audit-chat-context");
});

test("side panel displays local member risk and saves manual risk changes", async ({ page }) => {
  await page.addInitScript(({ observation, judgment, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return { ok: true, observation };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select"] }), { status: 200 });
      }
      if (url.includes("/api/members/observe")) {
        window.memberObserveRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          profiles: [
            {
              key: "uid:fixture123",
              riskLevel: "watch",
              aliases: ["fixture-user"],
              uids: ["fixture123"],
              ips: ["118.235"],
              observationCount: 3,
              postCount: 2,
              commentCount: 1
            },
            {
              key: "ip-name:223.39:commenter",
              riskLevel: "low",
              aliases: ["commenter"],
              uids: [],
              ips: ["223.39"],
              observationCount: 1,
              postCount: 0,
              commentCount: 1
            }
          ]
        }), { status: 200 });
      }
      if (url.includes("/api/members/risk")) {
        window.memberRiskRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/judge")) {
        window.memberJudgeRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          auditId: "audit-test",
          card: judgment
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), judgment: judgmentFixture("Member-aware judgment"), status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#judgeButton").click();

  await expect(page.locator("#memberPanel")).toContainText("fixture-user");
  await expect(page.locator("#memberPanel")).toContainText("uid:fixture123");
  await expect(page.locator("#memberPanel")).toContainText("commenter");
  await page.locator("[data-member-risk-key='uid:fixture123']").selectOption("high");
  const observedGalleryId = await page.evaluate(() => window.memberObserveRequestBody?.observation?.galleryId);
  const memberObserveComments = await page.evaluate(() => window.memberObserveRequestBody?.observation?.comments || []);
  const memberJudgeComments = await page.evaluate(() => window.memberJudgeRequestBody?.observation?.comments || []);
  const riskBody = await page.evaluate(() => window.memberRiskRequestBody);

  expect(observedGalleryId).toBe("thesingularity");
  expect(memberObserveComments).toHaveLength(1);
  expect(memberObserveComments[0].text).toBe("@bot defense(3)");
  expect(memberJudgeComments).toEqual([]);
  expect(riskBody).toMatchObject({ key: "uid:fixture123", riskLevel: "high" });
});

test("side panel refreshes local member risk without running an LLM judgment", async ({ page }) => {
  await page.addInitScript(({ observation, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          window.memberRiskObserveTabCalls = (window.memberRiskObserveTabCalls || 0) + 1;
          return { ok: true, observation };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select"] }), { status: 200 });
      }
      if (url.includes("/api/members/observe")) {
        window.memberRiskObserveRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({
          profiles: [{
            key: "uid:local-only",
            riskLevel: "watch",
            aliases: ["local-only-user"],
            uids: ["local-only"],
            ips: [],
            observationCount: 1,
            postCount: 1,
            commentCount: 0
          }]
        }), { status: 200 });
      }
      if (url.includes("/api/judge")) {
        window.memberRiskUnexpectedJudgeCalls = (window.memberRiskUnexpectedJudgeCalls || 0) + 1;
        return new Response(JSON.stringify({ error: "judge should not be called" }), { status: 500 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), status: proxyStatus(false) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#memberRiskButton").click();

  await expect(page.locator("#memberPanel")).toContainText("local-only-user");
  await expect(page.locator("#memberPanel")).toContainText("uid:local-only");
  await expect(page.locator("#summaryPanel")).toBeHidden();
  const observeCalls = await page.evaluate(() => window.memberRiskObserveTabCalls || 0);
  const judgeCalls = await page.evaluate(() => window.memberRiskUnexpectedJudgeCalls || 0);
  const observedGalleryId = await page.evaluate(() => window.memberRiskObserveRequestBody?.observation?.galleryId);

  expect(observeCalls).toBe(1);
  expect(judgeCalls).toBe(0);
  expect(observedGalleryId).toBe("thesingularity");
});

test("side panel saves local member notes without running an LLM judgment", async ({ page }) => {
  await page.addInitScript(({ observation, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return { ok: true, observation };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input, options) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select"] }), { status: 200 });
      }
      if (url.includes("/api/members/observe")) {
        return new Response(JSON.stringify({
          profiles: [{
            key: "uid:note-user",
            riskLevel: "watch",
            riskNote: "prior moderator context",
            aliases: ["note-user"],
            uids: ["note-user"],
            ips: [],
            observationCount: 2,
            postCount: 1,
            commentCount: 1
          }]
        }), { status: 200 });
      }
      if (url.includes("/api/members/risk")) {
        window.memberNoteRiskRequestBody = JSON.parse(String(options?.body || "{}"));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/judge") || url.includes("/api/chat/context") || url.includes("openai-oauth")) {
        window.memberNoteUnexpectedLlmCalls = (window.memberNoteUnexpectedLlmCalls || 0) + 1;
        return new Response(JSON.stringify({ error: "LLM should not be called" }), { status: 500 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), status: proxyStatus(false) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#memberRiskButton").click();

  const noteInput = page.locator("[data-member-risk-note-key='uid:note-user']");
  await expect(page.locator(".member-risk-controls [data-member-risk-note-save-key='uid:note-user']")).toHaveText("save");
  await expect(page.locator(".member-note-row [data-member-risk-note-save-key='uid:note-user']")).toHaveCount(0);
  await expect(noteInput).toHaveValue("prior moderator context");
  await noteInput.fill("repeat baiting near blocklist");
  await page.locator("[data-member-risk-note-save-key='uid:note-user']").click();

  const riskBody = await page.evaluate(() => window.memberNoteRiskRequestBody);
  const llmCalls = await page.evaluate(() => window.memberNoteUnexpectedLlmCalls || 0);
  expect(riskBody).toMatchObject({
    key: "uid:note-user",
    riskLevel: "watch",
    note: "repeat baiting near blocklist"
  });
  expect(llmCalls).toBe(0);
});

test("side panel explains backend fetch failures instead of showing raw Failed to fetch", async ({ page }) => {
  await page.addInitScript(() => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async () => ({ ok: false, reason: "native host missing in test" })
    };
    window.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
  });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#judgeButton").click();

  await expect(page.locator("#errorPanel")).toContainText("Backend auto-start failed");
  await expect(page.locator("#errorPanel")).toContainText("npm run install:native-host");
});

test("side panel auto-starts backend through native messaging and retries judgment", async ({ page }) => {
  let healthAttempts = 0;
  let ensureBackendCalls = 0;
  await page.addInitScript(({ observation, judgment, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_ENSURE_BACKEND") {
          window.ensureBackendCalls = (window.ensureBackendCalls || 0) + 1;
          return { ok: true, started: true, health: { ok: true } };
        }
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return { ok: true, observation };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/health")) {
        window.healthAttempts = (window.healthAttempts || 0) + 1;
        if (window.healthAttempts === 1) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response(JSON.stringify({ features: ["members.observe", "openai-oauth-proxy", "judge.model-select"] }), { status: 200 });
      }
      if (url.includes("/api/judge")) {
        return new Response(JSON.stringify({
          auditId: "audit-test",
          card: judgment
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), judgment: judgmentFixture("Auto-start judgment rendered"), status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#judgeButton").click();

  await expect(page.getByText("Auto-start judgment rendered")).toBeVisible();
  await expect(page.getByText("final_human_decision_required: true")).toBeVisible();
  healthAttempts = await page.evaluate(() => window.healthAttempts || 0);
  ensureBackendCalls = await page.evaluate(() => window.ensureBackendCalls || 0);
  expect(healthAttempts).toBeGreaterThanOrEqual(2);
  expect(ensureBackendCalls).toBe(1);
});

test("side panel shows openai-oauth proxy guidance without token paste or Codex login UI", async ({ page }) => {
  let tokenEndpointCalled = false;
  let proxyCalled = false;
  let codexLoginCalled = false;
  await page.addInitScript(({ status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_ENSURE_BACKEND") return { ok: true, started: false, health: { ok: true } };
        if (message.type === "MAVEN_ENSURE_OPENAI_OAUTH_PROXY") {
          window.proxyCalled = true;
          return { ok: true, proxyReady: true, proxyCommand: "npx -y openai-oauth --port 10531" };
        }
        if (message.type === "MAVEN_OPEN_CODEX_LOGIN") {
          window.codexLoginCalled = true;
          return { ok: false, reason: "Codex login must not be launched by Maven" };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/api/auth/openai/oauth-token")) {
        window.tokenEndpointCalled = true;
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/health")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response("{}", { status: 200 });
    };
  }, { status: proxyStatus(false) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await expect(page.locator("#oauthPanel")).toBeVisible();
  await expect(page.locator("#oauthPanel")).toContainText("openai-oauth");
  await expect(page.locator("#oauthPanel")).toContainText("npx @openai/codex login");
  await expect(page.locator("#authStatus")).toContainText("openai-oauth-proxy");
  await page.locator("#startProxyButton").click();
  await expect(page.locator("#oauthTokenInput")).toHaveCount(0);
  await expect(page.locator("#authStatus")).toContainText("proxy ready");
  tokenEndpointCalled = await page.evaluate(() => window.tokenEndpointCalled || false);
  proxyCalled = await page.evaluate(() => window.proxyCalled || false);
  codexLoginCalled = await page.evaluate(() => window.codexLoginCalled || false);
  expect(tokenEndpointCalled).toBe(false);
  expect(proxyCalled).toBe(true);
  expect(codexLoginCalled).toBe(false);
});

test("side panel detects a stale backend before calling member observe", async ({ page }) => {
  let memberObserveCalled = false;
  await page.addInitScript(({ observation, status }) => {
    window.__DC_MAVEN_TEST__ = {
      sendMessage: async (message) => {
        if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
          return { ok: true, observation };
        }
        return { ok: true };
      }
    };
    window.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/openai/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/health")) {
        return new Response(JSON.stringify({ ok: true, service: "dcinside-maven-copilot" }), { status: 200 });
      }
      if (url.includes("/api/capabilities")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/api/members/observe")) {
        window.memberObserveCalled = true;
        return new Response("not found", { status: 404 });
      }
      return new Response("{}", { status: 200 });
    };
  }, { observation: observationFixture(), status: proxyStatus(true) });

  await page.goto(pathToFileURL(path.join(repoRoot, "extension/sidepanel.html")).toString());
  await page.locator("#judgeButton").click();

  await expect(page.locator("#errorPanel")).toContainText("stale backend");
  await expect(page.locator("#errorPanel")).toContainText("restart");
  memberObserveCalled = await page.evaluate(() => window.memberObserveCalled || false);
  expect(memberObserveCalled).toBe(false);
});
