import { z } from "zod";
import { redactObservation } from "../../shared/redaction.js";
import type { JudgePrompt, JudgmentCard, ModerationObservation, PolicyEvidence } from "../../shared/types.js";

const issueTypeSchema = z.enum([
  "이왜특/갤무관",
  "정떡",
  "완장고로시",
  "도배기/역류기",
  "이미지 리스크",
  "수익/홍보/강의팔이",
  "타커뮤 캡처/조롱",
  "요주의 계정/IP/VPN",
  "특갤봇 명령 후보"
]);

const recommendedActionTypeSchema = z.enum(["삭제 후보", "차단 후보", "보류", "공지", "특갤봇 명령 후보"]);

export const policyEvidenceSchema = z.object({
  rule_id: z.string().min(1),
  source_post_no: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  relevance: z.number().min(0).max(1),
  tags: z.array(z.string()),
  category: z.string().optional(),
  kind: z.enum(["rule", "exception", "procedure", "bot_command", "precedent"]).optional(),
  guidance: z.string().optional(),
  quote: z.string().optional(),
  source_title: z.string().optional()
}).strict();

const commentThreadAssessmentSchema = z.object({
  fighting_likelihood: z.enum(["low", "medium", "high"]),
  fighting_summary: z.string().min(1),
  per_user: z.array(z.object({
    user_key: z.string().min(1),
    display_name: z.string().optional(),
    uid: z.string().optional(),
    ip: z.string().optional(),
    comment_indices: z.array(z.number().int().positive()),
    role: z.enum(["aggressor", "target", "participant", "de-escalator", "neutral", "spam-or-bot"]),
    risk_level: z.enum(["low", "watch", "high"]),
    rationale: z.string().min(1),
    evidence_quotes: z.array(z.string().min(1))
  }).strict())
}).strict();

export const judgmentCardSchema = z.object({
  summary: z.string().min(1),
  issue_types: z.array(issueTypeSchema),
  matched_rules: z.array(policyEvidenceSchema),
  llm_reasoning: z.string().min(1),
  uncertainty: z.string().min(1),
  false_positive_risk: z.string().min(1),
  recommended_actions: z.array(z.object({
    type: recommendedActionTypeSchema,
    label: z.string().min(1),
    rationale: z.string().min(1)
  }).strict()),
  current_page_evidence: z.array(z.object({
    quote: z.string().min(1),
    location: z.string().min(1)
  }).strict()),
  policy_evidence: z.array(z.object({
    source_post_no: z.string().min(1),
    quote: z.string().min(1),
    rule_id: z.string().min(1)
  }).strict()),
  special_bot_command_candidates: z.array(z.string()),
  comment_thread_assessment: commentThreadAssessmentSchema.optional(),
  final_human_decision_required: z.literal(true)
}).strict();

export interface CreateJudgePromptOptions {
  observation: ModerationObservation;
  evidence: PolicyEvidence[];
  model: string;
  visionEnabled: boolean;
  mode?: "page" | "uploaded-images";
}

function schemaSkeleton(commentMode = false): string {
  const skeleton: Record<string, unknown> = {
    summary: "string",
    issue_types: ["이왜특/갤무관 | 정떡 | 완장고로시 | 도배기/역류기 | 이미지 리스크 | 수익/홍보/강의팔이 | 타커뮤 캡처/조롱 | 요주의 계정/IP/VPN | 특갤봇 명령 후보"],
    matched_rules: [{ rule_id: "string", source_post_no: "string", title: "string", excerpt: "string", relevance: 0.0, tags: ["string"] }],
    llm_reasoning: "string",
    uncertainty: "string",
    false_positive_risk: "string",
    recommended_actions: [{ type: "삭제 후보 | 차단 후보 | 보류 | 공지 | 특갤봇 명령 후보", label: "string", rationale: "string" }],
    current_page_evidence: [{ quote: "string", location: "body/comment/image/link/meta" }],
    policy_evidence: [{ source_post_no: "string", quote: "string", rule_id: "string" }],
    special_bot_command_candidates: ["@특갤봇 댓글방어(3)"],
    final_human_decision_required: true
  };
  if (commentMode) {
    skeleton.comment_thread_assessment = {
      fighting_likelihood: "low | medium | high",
      fighting_summary: "string",
      per_user: [{
        user_key: "uid:example | ip-name:ip:name | ip:example | name:example",
        display_name: "string",
        uid: "string",
        ip: "string",
        comment_indices: [1],
        role: "aggressor | target | participant | de-escalator | neutral | spam-or-bot",
        risk_level: "low | watch | high",
        rationale: "string",
        evidence_quotes: ["string"]
      }]
    };
  }
  return JSON.stringify(skeleton, null, 2);
}

function compactPromptText(value: unknown, max = 180): string {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function policyEvidenceForPrompt(evidence: PolicyEvidence[]): Array<{
  id: string;
  src: string;
  cat: string;
  rule: string;
  quote: string;
  rel: number;
}> {
  return evidence.map((item) => ({
    id: item.rule_id,
    src: item.source_post_no,
    cat: compactPromptText(item.category ?? item.tags[0] ?? "운영 근거", 60),
    rule: compactPromptText(item.guidance ?? item.excerpt, 180),
    quote: compactPromptText(item.quote ?? item.excerpt, 180),
    rel: item.relevance
  }));
}

export function createJudgePrompt(options: CreateJudgePromptOptions): JudgePrompt {
  const redactedObservation = redactObservation(options.observation);
  const uploadedImageMode = options.mode === "uploaded-images";
  const commentMode = redactedObservation.metadata?.mavenJudgmentScope === "comments-only";
  const imageMode = uploadedImageMode
    ? "uploaded post images only: attached images are from observation.images; ignore DCInside ads, banners, UI chrome, profile icons, recommendation widgets, and any full-page screenshot"
    : options.visionEnabled
      ? "visible screenshot may be attached separately; still cite text/DOM evidence when possible"
      : "vision is not configured: 이미지 판단은 텍스트/alt/문맥 기반, 시각 확인 필요";

  const system = [
    "You are a read-only DCInside moderation copilot for a human sub-manager.",
    "Never execute, recommend as final, or simulate irreversible moderation actions.",
    "You must judge from the provided current-page observation plus policy evidence. Retrieval hints are evidence, not a rules-only verdict.",
    "Always include final_human_decision_required: true.",
    "Allowed actions are only candidates/copy/prefill/open-tab/save-evidence. Forbidden actions include submit/delete/ban/post/comment/confirm/save/apply clicks.",
    "Return only valid JSON matching the requested schema."
  ].join("\n");

  const user = [
    `Model target: ${options.model}`,
    `Image handling: ${imageMode}`,
    "",
    "CURRENT PAGE OBSERVATION (redacted JSON):",
    JSON.stringify(redactedObservation, null, 2),
    "",
    "RETRIEVED POLICY / EVIDENCE POSTS:",
    JSON.stringify(policyEvidenceForPrompt(options.evidence)),
    "",
    "JUDGMENT REQUIREMENTS:",
    "- Compare current-page quotes against policy evidence source_post_no values side by side.",
    "- 완장고로시는 '완장/파딱/주딱/매니저' 단어 단독이 아니라 운영진 앵커 + 공격/해임/친목/권력남용 프레임 + 반복/여론몰이/저신뢰 정황을 함께 본다.",
    "- 닉언콘/친목 조항은 비활성화되었습니다. 단순 이모티콘, 콘, 스티커, 닉네임 언급만으로 삭제 후보나 차단 후보를 만들지 마세요.",
    ...(commentMode ? [
      "- 댓글 판단 모드: CURRENT PAGE OBSERVATION.comments와 bodyText에 있는 댓글만 판단하고 본문/이미지 판단은 하지 않는다.",
      "- 싸움 여부를 fighting_likelihood low/medium/high로 평가한다. 직접 지목, 비난/조롱/명령조, 반박이 오가는 흐름, 감정적 에스컬레이션을 함께 본다.",
      "- 농담, 짧은 단발성 반박, 문맥상 장난인 표현은 싸움으로 과대판단하지 않는다.",
      "- 개별 댓글러별로 uid > ip+name > ip > name 순서의 user_key를 정하고 per_user에 comment_indices, role, risk_level, rationale, evidence_quotes를 적는다.",
      "- 같은 댓글러가 여러 댓글을 쓴 경우 합산 평가하되, 어떤 댓글 번호와 인용문 때문인지 반드시 남긴다.",
      "- 댓글 판단 모드에서는 comment_thread_assessment를 반드시 채운다."
    ] : []),
    ...(uploadedImageMode ? [
      "- Judge only the author-uploaded images listed in CURRENT PAGE OBSERVATION.images and attached as image_url inputs.",
      "- Exclude DCInside ads, banners, UI elements, profile icons, recommendation widgets, and unrelated page chrome from the judgment.",
      "- If an image is risky, cite it with location image[index]/src plus nearbyText or alt when available.",
      "- If the attached images do not show a policy problem, return a low-risk or hold recommendation with explicit visual uncertainty."
    ] : []),
    "- If recommending a bot command, only propose text for the human to copy. Do not claim it was sent.",
    "- For @특갤봇 게시물방어(n), 댓글방어(n), 방어(n), n must be 1..10.",
    "- For @특갤봇 게시물번호, treat it only as a specific-post push-down candidate.",
    "- For image risks without vision, mark visual uncertainty explicitly.",
    "",
    "STRICT JSON SCHEMA SHAPE:",
    schemaSkeleton(commentMode)
  ].join("\n");

  return { system, user };
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced) return JSON.parse(fenced[1]);
  const objectMatch = trimmed.match(/\{[\s\S]*\}/u);
  if (objectMatch) return JSON.parse(objectMatch[0]);
  throw new Error("LLM output did not contain a JSON object");
}

export function validateJudgeCard(input: unknown): JudgmentCard {
  const parsed = typeof input === "string" ? parseJsonObject(input) : input;
  return judgmentCardSchema.parse(parsed) as JudgmentCard;
}
