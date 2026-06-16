import { z } from "zod";
import { redactObservation } from "../../shared/redaction.js";
import type { JudgePrompt, JudgmentCard, ModerationObservation, PolicyEvidence } from "../../shared/types.js";

const ISSUE_TYPE_VALUES = [
  "이왜특/갤무관",
  "이용약관/법률/사회통념",
  "정떡",
  "정치/지역/성별혐오",
  "완장고로시",
  "닉언/친목/사칭",
  "분탕/어그로",
  "종교/음모론",
  "반과학/유사과학",
  "선형글/레퍼런스 부족",
  "인증/팬보이/갈드컵",
  "도배기/역류기",
  "이미지 리스크",
  "수익/홍보/강의팔이",
  "프로그램 홍보",
  "주식/코인/투자",
  "국뽕/출산율/혐오떡밥",
  "타커뮤 캡처/조롱",
  "타갤/타커뮤 언급",
  "요주의 계정/IP/VPN",
  "비관론갤 활동",
  "허위사실/이미지 저해",
  "욕설싸움/분쟁",
  "금지 떡밥",
  "개념글 제한",
  "레퍼런스 기준",
  "허용 예외",
  "특갤봇 명령 후보"
] as const;

const RECOMMENDED_ACTION_TYPE_VALUES = ["삭제 후보", "차단 후보", "보류", "공지", "특갤봇 명령 후보"] as const;

const issueTypeSchema = z.enum(ISSUE_TYPE_VALUES);

const recommendedActionTypeSchema = z.enum(RECOMMENDED_ACTION_TYPE_VALUES);

type IssueTypeValue = z.infer<typeof issueTypeSchema>;
type RecommendedActionTypeValue = z.infer<typeof recommendedActionTypeSchema>;

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

const commentCliqueSignalTypeSchema = z.enum([
  "nickname_mention_only",
  "repeated_unnecessary_nickname_mentions",
  "affectionate_nickname_or_title",
  "personal_history_reference",
  "inside_joke",
  "off_topic_private_chat",
  "external_private_channel",
  "specific_user_recruitment",
  "named_user_fan_service",
  "clique_or_in_group_language",
  "staff_favoritism_or_staff_socializing",
  "accusation_only",
  "moderation_context",
  "false_positive_exempt"
]);

const commentCliqueSignalSeveritySchema = z.enum(["low", "medium", "high"]);

const commentCliqueEvidenceQuoteSchema = z.object({
  comment_index: z.number().int().positive(),
  speaker_user_key: z.string().optional(),
  target_user_key: z.string().optional(),
  quote: z.string().min(1),
  signal_type: commentCliqueSignalTypeSchema,
  severity: commentCliqueSignalSeveritySchema,
  why_it_matters: z.string().min(1)
}).strict();

const commentCliqueSignalSchema = z.object({
  signal_type: commentCliqueSignalTypeSchema,
  severity: commentCliqueSignalSeveritySchema,
  comment_indices: z.array(z.number().int().positive()),
  user_keys: z.array(z.string()),
  rationale: z.string().min(1)
}).strict();

const commentThreadAssessmentSchema = z.object({
  fighting_likelihood: z.enum(["low", "medium", "high"]),
  fighting_summary: z.string().min(1),
  clique_likelihood: z.enum(["low", "medium", "high"]).optional(),
  clique_summary: z.string().min(1).optional(),
  nickname_mention_policy_risk: z.enum(["low", "medium", "high"]).optional(),
  clique_requires_human_review: z.boolean().optional(),
  clique_confidence: z.number().min(0).max(1).optional(),
  clique_signals: z.array(commentCliqueSignalSchema).optional(),
  clique_fp_guardrails_applied: z.array(z.string()).optional(),
  per_user: z.array(z.object({
    user_key: z.string().min(1),
    display_name: z.string().optional(),
    uid: z.string().optional(),
    ip: z.string().optional(),
    comment_indices: z.array(z.number().int().positive()),
    role: z.enum(["aggressor", "target", "participant", "de-escalator", "neutral", "spam-or-bot"]),
    risk_level: z.enum(["low", "watch", "high"]),
    rationale: z.string().min(1),
    evidence_quotes: z.array(z.string().min(1)),
    clique_role: z.enum(["initiator", "participant", "mentioned_user", "target", "amplifier", "neutral"]).optional(),
    clique_risk_level: z.enum(["low", "medium", "high"]).optional(),
    clique_rationale: z.string().min(1).optional(),
    clique_evidence_quotes: z.array(commentCliqueEvidenceQuoteSchema).optional(),
    clique_fp_exemptions: z.array(z.string()).optional()
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

export interface CreatePageTextJudgePromptOptions {
  observation: ModerationObservation;
  evidence: PolicyEvidence[];
  model: string;
}

function schemaSkeleton(commentMode = false): string {
  const skeleton: Record<string, unknown> = {
    summary: "string",
    issue_types: [ISSUE_TYPE_VALUES.join(" | ")],
    matched_rules: [{ rule_id: "string", source_post_no: "string", title: "string", excerpt: "string", relevance: 0.0, tags: ["string"] }],
    llm_reasoning: "string",
    uncertainty: "string",
    false_positive_risk: "string",
    recommended_actions: [{ type: RECOMMENDED_ACTION_TYPE_VALUES.join(" | "), label: "string", rationale: "string" }],
    current_page_evidence: [{ quote: "string", location: "body/comment/image/link/meta" }],
    policy_evidence: [{ source_post_no: "string", quote: "string", rule_id: "string" }],
    special_bot_command_candidates: ["@특갤봇 댓글방어(3)"],
    final_human_decision_required: true
  };
  if (commentMode) {
    skeleton.comment_thread_assessment = {
      fighting_likelihood: "low | medium | high",
      fighting_summary: "string",
      clique_likelihood: "low | medium | high",
      clique_summary: "string",
      nickname_mention_policy_risk: "low | medium | high",
      clique_requires_human_review: true,
      clique_confidence: 0.0,
      clique_signals: [{
        signal_type: "nickname_mention_only | repeated_unnecessary_nickname_mentions | affectionate_nickname_or_title | personal_history_reference | inside_joke | off_topic_private_chat | external_private_channel | specific_user_recruitment | named_user_fan_service | clique_or_in_group_language | staff_favoritism_or_staff_socializing | accusation_only | moderation_context | false_positive_exempt",
        severity: "low | medium | high",
        comment_indices: [1],
        user_keys: ["uid:example"],
        rationale: "string"
      }],
      clique_fp_guardrails_applied: ["nickname_mention_only_is_not_clique"],
      per_user: [{
        user_key: "uid:example | ip-name:ip:name | ip:example | name:example",
        display_name: "string",
        uid: "string",
        ip: "string",
        comment_indices: [1],
        role: "aggressor | target | participant | de-escalator | neutral | spam-or-bot",
        risk_level: "low | watch | high",
        rationale: "string",
        evidence_quotes: ["string"],
        clique_role: "initiator | participant | mentioned_user | target | amplifier | neutral",
        clique_risk_level: "low | medium | high",
        clique_rationale: "string",
        clique_evidence_quotes: [{
          comment_index: 1,
          speaker_user_key: "uid:example",
          target_user_key: "uid:example",
          quote: "string",
          signal_type: "personal_history_reference",
          severity: "low | medium | high",
          why_it_matters: "string"
        }],
        clique_fp_exemptions: ["emoji_or_sticker_only_is_not_clique"]
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

function pageTextObservationForPrompt(observation: ModerationObservation): Record<string, unknown> {
  const redacted = redactObservation({ ...observation, images: [] }) as unknown as Record<string, unknown>;
  const textOnlyObservation = { ...redacted };
  delete textOnlyObservation.images;
  return textOnlyObservation;
}

function pageTextSchemaSkeleton(): string {
  return JSON.stringify({
    summary: "string",
    issue_types: [ISSUE_TYPE_VALUES.join(" | ")],
    matched_rules: [{ rule_id: "string", source_post_no: "string", title: "string", excerpt: "string", relevance: 0.0, tags: ["string"] }],
    llm_reasoning: "string",
    uncertainty: "string",
    false_positive_risk: "string",
    recommended_actions: [{ type: RECOMMENDED_ACTION_TYPE_VALUES.join(" | "), label: "string", rationale: "string" }],
    current_page_evidence: [{ quote: "string", location: "body/comment/link/meta" }],
    policy_evidence: [{ source_post_no: "string", quote: "string", rule_id: "string" }],
    special_bot_command_candidates: ["@bot command candidate"],
    final_human_decision_required: true
  }, null, 2);
}

function currentPublicPolicyRequirements(): string[] {
  return [
    "- Apply the 2026-06-13 thesingularity public rules when relevant. Key categories include 닉언/친목/사칭, 분탕/어그로, 종교/음모론, 반과학/유사과학, 레퍼런스 없는 선형글, 인증 없는 현직자/전공자 주장, 팬보이/갈드컵, 주식/코인/투자, 국뽕/출산율/혐오떡밥, 정치/지역/성별혐오, 타갤/타커뮤 언급, 비관론갤 활동, 허위사실/이미지 저해, 욕설싸움/분쟁, 금지 떡밥, 개념글 제한, 레퍼런스 기준, 프로그램 홍보.",
    "- 닉언/친목/사칭은 실제 닉네임 언급, 사적 친분 과시, 외부 채널/인그룹 언어, 타인 사칭 근거를 현재 페이지에서 인용한다. 댓글 모드에서는 nickname_mention_policy_risk와 clique_likelihood를 분리한다.",
    "- 레퍼런스 없는 선형글은 특이점주의에 반하는 주장(예: AGI 불가능, 기술적 특이점은 2045년 이후)을 하면서 인정 가능한 레퍼런스가 없는 경우로 본다.",
    "- 레퍼런스 기준은 공식 발언/원문, 공신력 있는 논문, 석박사급 학술 내용, 제도권 언론 기사 순으로 본다. 본인의 생각을 그럴듯하게 쓴 글, 사설, 기고문은 레퍼런스로 보지 않는다.",
    "- 정치/지역/성별혐오는 글과 댓글 모두 금지다. 이미 확정된 국가 차원의 정책 사실 전달만 예외일 수 있고, 지지/조롱/반복/사설성 목적이 섞이면 예외로 보지 않는다.",
    "- 프로그램 홍보는 단순 홍보 금지, 정보 가치가 충분하면 영리 목적도 허용 가능, 유용하거나 반응이 좋으면 허용 가능, 동일 프로그램은 최대 2회 기준으로 본다.",
    "- 사실에 기반한 완장 비판, 현재 기술 (AI 등)에 대한 비판, 단순 욕설은 그 자체만으로 삭제나 차단 사유가 아니다."
  ];
}

export function createPageTextJudgePrompt(options: CreatePageTextJudgePromptOptions): JudgePrompt {
  const redactedObservation = pageTextObservationForPrompt(options.observation);
  const system = [
    "You are a read-only DCInside moderation copilot for a human sub-manager.",
    "Never execute, recommend as final, or simulate irreversible moderation actions.",
    "You must judge from the provided current-page text observation plus policy evidence. Retrieval hints are evidence, not a rules-only verdict.",
    "Always include final_human_decision_required: true.",
    "Allowed actions are only candidates/copy/prefill/open-tab/save-evidence. Forbidden actions include submit/delete/ban/post/comment/confirm/save/apply clicks.",
    "Return only valid JSON matching the requested schema."
  ].join("\n");

  const user = [
    `Model target: ${options.model}`,
    "",
    "CURRENT PAGE TEXT OBSERVATION (redacted JSON):",
    JSON.stringify(redactedObservation, null, 2),
    "",
    "RETRIEVED POLICY / EVIDENCE POSTS:",
    JSON.stringify(policyEvidenceForPrompt(options.evidence)),
    "",
    "JUDGMENT REQUIREMENTS:",
    "- Compare current-page quotes against policy evidence source_post_no values side by side.",
    ...currentPublicPolicyRequirements(),
    "- Use only text fields present in the current-page observation and retrieved policy evidence.",
    "- Do not use absent local member state or retrieved policy context alone as standalone moderation evidence.",
    "- If recommending a bot command, only propose text for the human to copy. Do not claim it was sent.",
    "- For bot defense durations, n must be 1..10.",
    "- For targeted con/sticker harassment, consider repeat use against a specific user or hostile framing before recommending action.",
    "- If the current-page text is insufficient, return a hold recommendation with explicit uncertainty.",
    "",
    "STRICT JSON SCHEMA SHAPE:",
    pageTextSchemaSkeleton()
  ].join("\n");

  return { system, user };
}

export function createJudgePrompt(options: CreateJudgePromptOptions): JudgePrompt {
  const redactedObservation = redactObservation(options.observation);
  const uploadedImageMode = options.mode === "uploaded-images";
  const commentEmoticonNameMode = redactedObservation.metadata?.mavenJudgmentScope === "comment-emoticon-names-only";
  const commentTextMode = redactedObservation.metadata?.mavenJudgmentScope === "comments-only";
  const commentMode = commentTextMode || commentEmoticonNameMode;
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
    ...currentPublicPolicyRequirements(),
    "- 완장고로시는 '완장/파딱/주딱/매니저' 단어 단독이 아니라 운영진 앵커 + 공격/해임/친목/권력남용 프레임 + 반복/여론몰이/저신뢰 정황을 함께 본다.",
    "- 저격성 콘사용은 별도 기준입니다. 특정 유저를 겨냥한 조롱/공격 목적의 콘, 이모티콘, 스티커 사용이 같은 유저에게 반복되면 7~31일 차단 후보로 보고, 모르고 사용한 것처럼 보이거나 단발성/경미한 경우에는 1일 또는 6시간 차단 후보로 낮춰 제안하세요. 단순 콘/스티커만으로 적용하지 말고 사용자 반복성, 대상 특정성, 조롱/공격 맥락을 인용하세요.",
    ...(commentTextMode ? [
      "- 댓글 판단 모드: CURRENT PAGE OBSERVATION.comments와 bodyText에 있는 댓글만 판단하고 본문/이미지 판단은 하지 않는다.",
      "- 싸움 여부를 fighting_likelihood low/medium/high로 평가한다. 직접 지목, 비난/조롱/명령조, 반박이 오가는 흐름, 감정적 에스컬레이션을 함께 본다.",
      "- 농담, 짧은 단발성 반박, 문맥상 장난인 표현은 싸움으로 과대판단하지 않는다.",
      "- 개별 댓글러별로 uid > ip+name > ip > name 순서의 user_key를 정하고 per_user에 comment_indices, role, risk_level, rationale, evidence_quotes를 적는다.",
      "- 같은 댓글러가 여러 댓글을 쓴 경우 합산 평가하되, 어떤 댓글 번호와 인용문 때문인지 반드시 남긴다.",
      "- If bodyText contains LOCAL MEMBER CONTEXT, use only those high-risk or noted local profiles as supporting context for the matching comment users. Never use absent local member state, low/watch-without-note state, or local member context alone as standalone moderation evidence.",
      "- 댓글 판단 모드에서는 comment_thread_assessment를 반드시 채운다."
    ] : []),
    ...(commentEmoticonNameMode ? [
      "- 댓글 이모티콘 이름 탐지 모드: CURRENT PAGE OBSERVATION.bodyText의 DETECTED COMMENT EMOTICON NAMES와 COMMENT EMOTICON OCCURRENCES만으로 특정 이름의 이모티콘/콘/스티커 존재 여부를 판단한다.",
      "- FORBIDDEN COMMENT EMOTICON NAMES는 사용자가 관리하는 금지 이모티콘 이름 목록이다. 기본 목록에는 '갱생특갤콘'이 포함될 수 있으며, 현재 observation에 제공된 목록만 기준으로 삼는다.",
      "- detected name, aliases, sourceHint 중 하나가 금지 목록 이름과 정확히 일치하면 금지 이모티콘 발견으로 표시하고 current_page_evidence에 금지 이름, 탐지 이름, occurrence index, comment[index]를 남긴다.",
      "- 이미지/비전 판단을 하지 말고, 추출된 name/aliases/sourceHint/nearbyText와 댓글 문맥만 사용한다.",
      "- 금지 또는 제재 대상 이름이 발견되면 exact name, occurrence index, comment[index], 주변 댓글 문맥을 current_page_evidence에 남긴다.",
      "- 단순히 콘이 있었다는 사실만으로 차단 후보를 만들지 말고, 금지된 이름인지 또는 저격성 콘사용 기준의 반복성/대상 특정성/조롱 맥락이 있는지 구분한다.",
      "- 댓글 이모티콘 이름 탐지 모드에서는 comment_thread_assessment를 가능한 한 채운다."
    ] : []),
    ...(commentMode ? [
      "- 친목/네임드화 판단도 수행한다. clique_likelihood low/medium/high와 clique_summary를 채운다.",
      "- 닉언 정책 리스크와 친목/네임드화 리스크는 분리한다. nickname_mention_policy_risk는 별도 필드로 적는다.",
      "- 단순 닉네임 언급이나 @호출은 닉언 정책 리스크로 분리하고, 사적 친분/내부자 언어/외부 채널 근거가 없으면 친목/네임드화 high로 과대판정하지 않는다. 이런 구분은 nickname_mention_only 또는 false_positive_exempt signal로 남긴다.",
      "- '친목이다'라는 비난 자체는 근거가 아니다. 실제 댓글에 사적 친분, 내부자 언어, 외부 채널, 반복적 개인 대화가 있어야 한다.",
      "- high는 외부/사적 채널 유도, 우리끼리식 배제 언어, 반복적 사담, 특정 고닉 중심 호감작 등 강한 근거가 있을 때만 사용한다.",
      "- per_user에는 가능하면 clique_role, clique_risk_level, clique_rationale, clique_evidence_quotes, clique_fp_exemptions를 함께 채운다.",
      "- clique_evidence_quotes는 실제 댓글 원문에서 최소 구간만 인용하고 signal_type, severity, why_it_matters를 남긴다."
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

function aliasKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[_\s]+/gu, "-");
}

const issueTypeAliases: Record<string, IssueTypeValue> = {
  "off-topic": "이왜특/갤무관",
  "irrelevant": "이왜특/갤무관",
  "off-topic/irrelevant": "이왜특/갤무관",
  "law-social-norms": "이용약관/법률/사회통념",
  "illegal-content": "이용약관/법률/사회통념",
  "politics": "정떡",
  "political": "정떡",
  "politics-region-gender-hate": "정치/지역/성별혐오",
  "gender-hate": "정치/지역/성별혐오",
  "regional-slur": "정치/지역/성별혐오",
  "moderator-harassment": "완장고로시",
  "staff-harassment": "완장고로시",
  "nickname-clique-impersonation": "닉언/친목/사칭",
  "nickname-mention": "닉언/친목/사칭",
  "clique": "닉언/친목/사칭",
  "impersonation": "닉언/친목/사칭",
  "trolling": "분탕/어그로",
  "ragebait": "분탕/어그로",
  "religion-conspiracy": "종교/음모론",
  "conspiracy": "종교/음모론",
  "religion": "종교/음모론",
  "anti-science": "반과학/유사과학",
  "pseudoscience": "반과학/유사과학",
  "anti-intellectualism": "반과학/유사과학",
  "unreferenced-anti-singularity": "선형글/레퍼런스 부족",
  "linear-no-reference": "선형글/레퍼런스 부족",
  "missing-reference": "선형글/레퍼런스 부족",
  "credentials-fanboy-flamebait": "인증/팬보이/갈드컵",
  "flamebait": "인증/팬보이/갈드컵",
  "spam": "도배기/역류기",
  "flood": "도배기/역류기",
  "macro": "도배기/역류기",
  "reverse-flooding": "도배기/역류기",
  "image-risk": "이미지 리스크",
  "profit/promo/course-sales": "수익/홍보/강의팔이",
  "promotion": "수익/홍보/강의팔이",
  "program-promotion": "프로그램 홍보",
  "investment": "주식/코인/투자",
  "stocks-coins-investment": "주식/코인/투자",
  "nationalism-birthrate-hatebait": "국뽕/출산율/혐오떡밥",
  "nationalism": "국뽕/출산율/혐오떡밥",
  "external-community-capture/mockery": "타커뮤 캡처/조롱",
  "external-community": "타커뮤 캡처/조롱",
  "other-gallery-community-mention": "타갤/타커뮤 언급",
  "other-gallery": "타갤/타커뮤 언급",
  "watchlisted-account/ip/vpn": "요주의 계정/IP/VPN",
  "account/ip/vpn": "요주의 계정/IP/VPN",
  "pessimism-gallery-activity": "비관론갤 활동",
  "false-information": "허위사실/이미지 저해",
  "reputation-harm": "허위사실/이미지 저해",
  "abusive-fight": "욕설싸움/분쟁",
  "banned-topic": "금지 떡밥",
  "front-page-restriction": "개념글 제한",
  "reference-standard": "레퍼런스 기준",
  "allowed-exception": "허용 예외",
  "bot-command-candidate": "특갤봇 명령 후보"
};

const recommendedActionTypeAliases: Record<string, RecommendedActionTypeValue> = {
  "delete-candidate": "삭제 후보",
  "deletion-candidate": "삭제 후보",
  "ban-candidate": "차단 후보",
  "block-candidate": "차단 후보",
  "hold": "보류",
  "review": "보류",
  "human-review": "보류",
  "manual-review": "보류",
  "notice": "공지",
  "announcement": "공지",
  "bot-command-candidate": "특갤봇 명령 후보",
  "copy-bot-command": "특갤봇 명령 후보"
};

function normalizeIssueType(value: unknown): IssueTypeValue | undefined {
  if (issueTypeSchema.safeParse(value).success) return value as IssueTypeValue;
  return issueTypeAliases[aliasKey(value)];
}

function normalizeRecommendedActionType(value: unknown): RecommendedActionTypeValue {
  if (recommendedActionTypeSchema.safeParse(value).success) return value as RecommendedActionTypeValue;
  return recommendedActionTypeAliases[aliasKey(value)] ?? "보류";
}

function normalizeJudgeCardEnums(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const card = input as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...card };

  if (Array.isArray(card.issue_types)) {
    normalized.issue_types = card.issue_types
      .map(normalizeIssueType)
      .filter((value): value is IssueTypeValue => Boolean(value));
  }

  if (Array.isArray(card.recommended_actions)) {
    normalized.recommended_actions = card.recommended_actions.map((action) => {
      if (!action || typeof action !== "object" || Array.isArray(action)) return action;
      const actionObject = action as Record<string, unknown>;
      return {
        ...actionObject,
        type: normalizeRecommendedActionType(actionObject.type)
      };
    });
  }

  return normalized;
}

export function validateJudgeCard(input: unknown): JudgmentCard {
  const parsed = typeof input === "string" ? parseJsonObject(input) : input;
  return judgmentCardSchema.parse(normalizeJudgeCardEnums(parsed)) as JudgmentCard;
}
