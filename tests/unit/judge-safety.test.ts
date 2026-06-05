import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditDecision, judgeObservation } from "../../src/backend/judge/pipeline.js";
import { createJudgePrompt, validateJudgeCard } from "../../src/backend/judge/schema.js";
import { redactObservation, redactText } from "../../src/shared/redaction.js";
import { assertSafeAutomationAction, isIrreversibleActionLabel } from "../../src/shared/safety.js";
import { makeDefenseCommand, makePostPushCommand, parseBotCommand } from "../../src/shared/botCommands.js";
import type { ModerationObservation, PolicyEvidence } from "../../src/shared/types.js";

const observation: ModerationObservation = {
  url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=777777",
  title: "정떡 섞인 닉언콘 글",
  galleryId: "thesingularity",
  postNo: "777777",
  head: "일반",
  author: { name: "테스터", uid: "semiuser", ip: "1.2.3.4" },
  createdAtText: "2026.06.02 12:03:04",
  counts: { views: "100", recommends: "0", comments: "2" },
  bodyText: "본문에 정치 떡밥과 닉언콘이 함께 있습니다. password=secret-token",
  htmlExcerpt: "<div>정떡 닉언콘</div>",
  comments: [
    { id: "comment_li_1", author: "ㅇㅇ", text: "@특갤봇 방어(4)", date: "06.02 12:04:00", depth: 0 },
    { id: "reply_li_2", author: "테스터2", text: "@테스터 닉언콘", date: "06.02 12:05:00", depth: 1 }
  ],
  images: [{ src: "https://dcimg.example/image.png", alt: "정치 캡처", nearbyText: "이미지 주변 문맥" }],
  links: [{ href: "https://example.com/promo", text: "홍보 링크" }],
  selectedText: "정치 떡밥",
  viewportText: "현재 보이는 정떡 닉언콘 문맥",
  clickableLabels: ["댓글 보기", "삭제", "등록"],
  metadata: { userAgent: "should-not-store", cookie: "abc" }
};

const evidence: PolicyEvidence[] = [
  {
    rule_id: "seed-nickcon-after-2026-06-01",
    source_post_no: "1224888",
    title: "닉언콘 금지",
    excerpt: "2026-06-01 이후 닉언콘은 친목질로 보고 31일 차단 후보",
    relevance: 0.97,
    tags: ["nickcon"]
  },
  {
    rule_id: "post-1226405-bot-command",
    source_post_no: "1226405",
    title: "특갤봇 명령어",
    excerpt: "@특갤봇 게시물방어(n), 댓글방어(n), 방어(n)의 n은 1~10",
    relevance: 0.93,
    tags: ["bot_command"]
  }
];

describe("judge schema, prompt, audit, and safety", () => {
  it("builds an LLM prompt with direct page observation and policy source post numbers", () => {
    const prompt = createJudgePrompt({ observation, evidence, model: "test-model", visionEnabled: false });

    expect(prompt.user).toContain("정떡 섞인 닉언콘 글");
    expect(prompt.user).toContain("@특갤봇 방어(4)");
    expect(prompt.user).toContain("https://dcimg.example/image.png");
    expect(prompt.user).toContain("1224888");
    expect(prompt.user).toContain("final_human_decision_required");
    expect(prompt.user).toContain("텍스트/alt/문맥 기반, 시각 확인 필요");
    expect(prompt.user).toContain("단순 이모티콘");
    expect(prompt.user).toContain("저격성 콘사용");
    expect(prompt.user).toContain("7~31일");
    expect(prompt.user).toContain("1일 또는 6시간");
    expect(prompt.user).toContain("운영진 앵커 + 공격/해임/친목/권력남용 프레임");
    expect(prompt.user).not.toContain("닉언콘/친목 |");
  });

  it("uses compact policy evidence in prompts instead of verbose retrieved objects", () => {
    const compactEvidence: PolicyEvidence[] = [{
      rule_id: "post-1226405#compact",
      source_post_no: "1226405",
      title: "very long source title that should not dominate the prompt",
      excerpt: "legacy excerpt ".repeat(80),
      category: "특갤봇 명령 후보",
      kind: "bot_command",
      guidance: "n은 1~10 정수 범위로만 제안한다.",
      quote: "@특갤봇 댓글방어(n)의 n은 1~10",
      relevance: 0.98,
      tags: ["특갤봇 명령 후보"]
    }];

    const prompt = createJudgePrompt({ observation, evidence: compactEvidence, model: "test-model", visionEnabled: false });
    const evidenceSection = prompt.user.split("RETRIEVED POLICY / EVIDENCE POSTS:")[1].split("JUDGMENT REQUIREMENTS:")[0];

    expect(evidenceSection.length).toBeLessThan(700);
    expect(evidenceSection).toContain("\"src\":\"1226405\"");
    expect(evidenceSection).toContain("\"rule\":\"n은 1~10 정수 범위로만 제안한다.\"");
    expect(evidenceSection).toContain("\"quote\":\"@특갤봇 댓글방어(n)의 n은 1~10\"");
    expect(evidenceSection).not.toContain("legacy excerpt legacy excerpt legacy excerpt");
    expect(evidenceSection).not.toContain("very long source title");
  });

  it("accepts only strict judgment cards that require a final human decision", () => {
    const valid = validateJudgeCard({
      summary: "정떡 및 특갤봇 명령 후보",
      issue_types: ["정떡", "특갤봇 명령 후보"],
      matched_rules: evidence,
      llm_reasoning: "현재 페이지와 1224888, 1226405 근거를 함께 보면 조치 후보입니다.",
      uncertainty: "중간",
      false_positive_risk: "맥락상 장난 댓글일 가능성은 남아 있습니다.",
      recommended_actions: [
        { type: "특갤봇 명령 후보", label: "@특갤봇 방어(4)", rationale: "n=1~10 범위" }
      ],
      current_page_evidence: [{ quote: "@테스터 닉언콘", location: "reply_li_2" }],
      policy_evidence: [{ source_post_no: "1224888", quote: "31일 차단 후보", rule_id: "seed-nickcon-after-2026-06-01" }],
      special_bot_command_candidates: ["@특갤봇 방어(4)"],
      final_human_decision_required: true
    });

    expect(valid.final_human_decision_required).toBe(true);
    expect(() => validateJudgeCard({ ...valid, final_human_decision_required: false })).toThrow();
  });

  it("adds fighting and per-user requirements in comments-only prompts", () => {
    const commentsOnlyObservation: ModerationObservation = {
      ...observation,
      title: `${observation.title} - 댓글 판단`,
      bodyText: "[1] ㅇㅇ ip:1.1: 야 너 왜 시비임?\n[2] 테스터2 uid:user2: 네가 먼저 싸웠잖아",
      htmlExcerpt: "",
      images: [],
      links: [],
      selectedText: "",
      viewportText: "[1] ㅇㅇ ip:1.1: 야 너 왜 시비임?\n[2] 테스터2 uid:user2: 네가 먼저 싸웠잖아",
      clickableLabels: [],
      metadata: { mavenJudgmentScope: "comments-only" }
    };

    const prompt = createJudgePrompt({ observation: commentsOnlyObservation, evidence, model: "test-model", visionEnabled: false });

    expect(prompt.user).toContain("댓글 판단 모드");
    expect(prompt.user).toContain("싸움 여부");
    expect(prompt.user).toContain("개별 댓글러");
    expect(prompt.user).toContain("comment_thread_assessment");
    expect(prompt.user).toContain("clique_likelihood");
    expect(prompt.user).toContain("nickname_mention_policy_risk");
    expect(prompt.user).toContain("nickname_mention_only");
  });

  it("adds text-only requirements for comment emoticon name detection prompts", () => {
    const emoticonObservation: ModerationObservation = {
      ...observation,
      title: `${observation.title} - 이모티콘 판단`,
      bodyText: [
        "COMMENT EMOTICON NAME JUDGMENT MODE",
        "FORBIDDEN COMMENT EMOTICON NAMES:",
        JSON.stringify(["갱생특갤콘"]),
        "DETECTED COMMENT EMOTICON NAMES:",
        JSON.stringify([{ name: "갱생특갤콘", count: 1, aliases: ["갱생특갤콘", "comment-con"], evidence: ["comment[2] @테스터 갱생특갤콘"] }]),
        "COMMENT EMOTICON OCCURRENCES:",
        JSON.stringify([{ index: 1, primaryName: "갱생특갤콘", names: ["갱생특갤콘"], sourceHint: "comment-con", nearbyText: "comment[2] @테스터 갱생특갤콘" }]),
        "COMMENTS:",
        "[2] 테스터2 uid:user2: @테스터 갱생특갤콘"
      ].join("\n"),
      images: [],
      links: [],
      metadata: { mavenJudgmentScope: "comment-emoticon-names-only" }
    };

    const prompt = createJudgePrompt({ observation: emoticonObservation, evidence, model: "test-model", visionEnabled: false });

    expect(prompt.user).toContain("댓글 이모티콘 이름 탐지 모드");
    expect(prompt.user).toContain("FORBIDDEN COMMENT EMOTICON NAMES");
    expect(prompt.user).toContain("갱생특갤콘");
    expect(prompt.user).toContain("금지 이모티콘 발견");
    expect(prompt.user).toContain("DETECTED COMMENT EMOTICON NAMES");
    expect(prompt.user).toContain("COMMENT EMOTICON OCCURRENCES");
    expect(prompt.user).toContain("이미지/비전 판단을 하지 말고");
    expect(prompt.user).toContain("comment_thread_assessment");
    expect(prompt.user).not.toContain("uploaded post images only");
  });

  it("accepts optional structured comment thread assessments", () => {
    const valid = validateJudgeCard({
      summary: "댓글 싸움 watch",
      issue_types: [],
      matched_rules: evidence.slice(0, 1),
      llm_reasoning: "댓글끼리 직접 반박이 오가며 감정적 표현이 있습니다.",
      uncertainty: "중간",
      false_positive_risk: "짧은 농담성 티키타카일 가능성",
      recommended_actions: [{ type: "보류", label: "댓글 흐름 확인", rationale: "개별 유저별 판단은 watch 수준" }],
      current_page_evidence: [{ quote: "네가 먼저 싸웠잖아", location: "comment[2]" }],
      policy_evidence: [{ source_post_no: "1224888", quote: "반복/여론몰이 정황", rule_id: "seed-nickcon-after-2026-06-01" }],
      special_bot_command_candidates: [],
      final_human_decision_required: true,
      comment_thread_assessment: {
        fighting_likelihood: "medium",
        fighting_summary: "두 유저가 서로를 직접 겨냥해 반박합니다.",
        clique_likelihood: "medium",
        clique_summary: "Repeated personal-context references need human review.",
        nickname_mention_policy_risk: "low",
        clique_requires_human_review: true,
        clique_confidence: 0.72,
        clique_signals: [{
          signal_type: "personal_history_reference",
          severity: "medium",
          comment_indices: [2],
          user_keys: ["uid:user2"],
          rationale: "The comment relies on a previous personal interaction."
        }],
        clique_fp_guardrails_applied: ["nickname_mention_only_is_not_clique"],
        per_user: [{
          user_key: "uid:user2",
          display_name: "테스터2",
          uid: "user2",
          comment_indices: [2],
          role: "participant",
          risk_level: "watch",
          rationale: "상대 지목과 싸움 프레임이 있으나 단발성입니다.",
          evidence_quotes: ["네가 먼저 싸웠잖아"],
          clique_role: "participant",
          clique_risk_level: "medium",
          clique_rationale: "Personal-context reference is present, but it is not enough for a high-risk clique finding.",
          clique_evidence_quotes: [{
            comment_index: 2,
            speaker_user_key: "uid:user2",
            quote: "네가 먼저 싸웠잖아",
            signal_type: "personal_history_reference",
            severity: "medium",
            why_it_matters: "This implies prior interaction between users."
          }],
          clique_fp_exemptions: ["emoji_or_sticker_only_is_not_clique"]
        }]
      }
    });

    expect(valid.comment_thread_assessment?.fighting_likelihood).toBe("medium");
    expect(valid.comment_thread_assessment?.clique_likelihood).toBe("medium");
    expect(valid.comment_thread_assessment?.per_user[0].user_key).toBe("uid:user2");
    expect(valid.comment_thread_assessment?.per_user[0].clique_risk_level).toBe("medium");
  });

  it("blocks irreversible automation labels in shared safety checks", () => {
    expect(isIrreversibleActionLabel("삭제")).toBe(true);
    expect(isIrreversibleActionLabel("댓글등록")).toBe(true);
    expect(isIrreversibleActionLabel("작성완료")).toBe(true);
    expect(assertSafeAutomationAction({ kind: "copy", label: "사유문 복사" }).allowed).toBe(true);
    expect(assertSafeAutomationAction({ kind: "click", label: "삭제" }).allowed).toBe(false);
    expect(assertSafeAutomationAction({ kind: "prefill", label: "사유 입력", selector: "textarea[name=reason]" }).allowed).toBe(true);
    expect(assertSafeAutomationAction({ kind: "prefill", label: "등록", selector: "button[type=submit]" }).allowed).toBe(false);
  });

  it("parses and generates only safe 특갤봇 candidate command text", () => {
    expect(parseBotCommand("@특갤봇 댓글방어(3)")?.minutes).toBe(3);
    expect(parseBotCommand("@특갤봇 방어(11)")).toBeNull();
    expect(makeDefenseCommand("게시물방어", 10)).toBe("@특갤봇 게시물방어(10)");
    expect(() => makeDefenseCommand("방어", 0)).toThrow();
    expect(makePostPushCommand("1226405")).toBe("@특갤봇 1226405");
  });

  it("redacts credentials from observations before prompt and audit storage", () => {
    const redacted = redactObservation(observation);
    const text = JSON.stringify(redacted);

    expect(redactText("cookie=abc password=hunter2 OPENAI_API_KEY=sk-test")).not.toContain("hunter2");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("abc");
    expect(text).toContain("[REDACTED]");
  });

  it("runs the judge with an injected LLM provider and writes a redacted audit log", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "maven-audit-"));
    try {
      const result = await judgeObservation({
        observation,
        screenshotDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        evidence,
        dataDir: tmp,
        llmProvider: async () => ({
          summary: "정떡 후보",
          issue_types: ["정떡"],
          matched_rules: evidence,
          llm_reasoning: "현재 페이지 직접 관측과 정책 근거를 비교했습니다.",
          uncertainty: "중간",
          false_positive_risk: "정치 인용일 가능성",
          recommended_actions: [{ type: "보류", label: "수동 검토", rationale: "최종 판단 필요" }],
          current_page_evidence: [{ quote: "정치 떡밥", location: "body" }],
          policy_evidence: [{ source_post_no: "1224888", quote: "31일 차단 후보", rule_id: "seed-nickcon-after-2026-06-01" }],
          special_bot_command_candidates: [],
          final_human_decision_required: true
        })
      });

      expect(result.card.final_human_decision_required).toBe(true);
      const audit = await readFile(result.auditPath, "utf8");
      expect(audit).toContain("observationHash");
      expect(audit).toContain("screenshotPath");
      expect(audit).not.toContain("secret-token");

      const decisionPath = await auditDecision({
        dataDir: tmp,
        auditId: result.auditId,
        decision: { outcome: "human-dismissed", note: "오탐", decidedAt: "2026-06-02T00:00:00.000Z" }
      });
      expect(decisionPath).toContain("decision");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
