import { describe, expect, it } from "vitest";
import { createPageTextJudgePrompt, validateJudgeCard } from "../../src/backend/judge/schema.js";
import type { ModerationObservation, PolicyEvidence } from "../../src/shared/types.js";

const observation: ModerationObservation = {
  url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1238050&page=1",
  title: "page text judge fixture",
  galleryId: "thesingularity",
  postNo: "1238050",
  bodyText: "본문 텍스트만으로 판단해야 하는 페이지입니다.",
  comments: [],
  images: [{ src: "https://dcimg.example/ignored.png", alt: "ignored", nearbyText: "ignored" }],
  links: [],
  clickableLabels: [],
  metadata: {}
};

const evidence: PolicyEvidence[] = [{
  rule_id: "policy-1",
  source_post_no: "1224888",
  title: "policy fixture",
  excerpt: "정책 근거 예시",
  relevance: 0.9,
  tags: ["정떡"]
}];

describe("page text judge prompt and validation", () => {
  it("uses the strict Korean enum labels in the page-text JSON schema prompt", () => {
    const prompt = createPageTextJudgePrompt({ observation, evidence, model: "gpt-5.5" });

    expect(prompt.user).toContain("이왜특/갤무관 | 이용약관/법률/사회통념 | 정떡");
    expect(prompt.user).toContain("닉언/친목/사칭");
    expect(prompt.user).toContain("선형글/레퍼런스 부족");
    expect(prompt.user).toContain("허용 예외");
    expect(prompt.user).toContain("삭제 후보 | 차단 후보 | 보류 | 공지 | 특갤봇 명령 후보");
    expect(prompt.user).not.toContain("use only text-based issue types allowed by the judgment schema");
    expect(prompt.user).not.toContain("delete candidate | ban candidate | hold | notice | bot command candidate");
  });

  it("normalizes legacy English enum aliases before strict judgment-card validation", () => {
    const card = validateJudgeCard({
      summary: "text-only judgment",
      issue_types: ["bot command candidate"],
      matched_rules: evidence,
      llm_reasoning: "The model followed the old English page-text schema labels.",
      uncertainty: "medium",
      false_positive_risk: "Needs human review.",
      recommended_actions: [{ type: "hold", label: "human review", rationale: "Do not fail the request on alias drift." }],
      current_page_evidence: [{ quote: "본문 텍스트", location: "body" }],
      policy_evidence: [{ source_post_no: "1224888", quote: "정책 근거", rule_id: "policy-1" }],
      special_bot_command_candidates: [],
      final_human_decision_required: true
    });

    expect(card.issue_types).toEqual(["특갤봇 명령 후보"]);
    expect(card.recommended_actions[0].type).toBe("보류");
  });
});
