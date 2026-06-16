export type IssueType =
  | "이왜특/갤무관"
  | "이용약관/법률/사회통념"
  | "정떡"
  | "정치/지역/성별혐오"
  | "완장고로시"
  | "닉언/친목/사칭"
  | "분탕/어그로"
  | "종교/음모론"
  | "반과학/유사과학"
  | "선형글/레퍼런스 부족"
  | "인증/팬보이/갈드컵"
  | "도배기/역류기"
  | "이미지 리스크"
  | "수익/홍보/강의팔이"
  | "프로그램 홍보"
  | "주식/코인/투자"
  | "국뽕/출산율/혐오떡밥"
  | "타커뮤 캡처/조롱"
  | "타갤/타커뮤 언급"
  | "요주의 계정/IP/VPN"
  | "비관론갤 활동"
  | "허위사실/이미지 저해"
  | "욕설싸움/분쟁"
  | "금지 떡밥"
  | "개념글 제한"
  | "레퍼런스 기준"
  | "허용 예외"
  | "특갤봇 명령 후보";

export type RecommendedActionType =
  | "삭제 후보"
  | "차단 후보"
  | "보류"
  | "공지"
  | "특갤봇 명령 후보";

export interface ObservationAuthor {
  name?: string;
  uid?: string;
  ip?: string;
  raw?: string;
}

export interface ObservationComment {
  id?: string;
  author?: string;
  authorIdentity?: ObservationAuthor;
  date?: string;
  text: string;
  depth: number;
}

export interface ObservationImage {
  src: string;
  alt?: string;
  nearbyText?: string;
  dataUrl?: string;
}

export interface ObservationLink {
  href: string;
  text?: string;
}

export interface ModerationObservation {
  url: string;
  title: string;
  galleryId?: string;
  postNo?: string;
  head?: string;
  author?: ObservationAuthor;
  createdAtText?: string;
  counts?: {
    views?: string;
    recommends?: string;
    comments?: string;
  };
  bodyText: string;
  htmlExcerpt?: string;
  comments: ObservationComment[];
  images: ObservationImage[];
  links: ObservationLink[];
  selectedText?: string;
  viewportText?: string;
  clickableLabels: string[];
  metadata: Record<string, unknown>;
}

export interface PolicyLink {
  href: string;
  text?: string;
}

export interface PolicyDocument {
  id: string;
  rule_id: string;
  source_post_no: string;
  title: string;
  author?: string;
  date?: string;
  url?: string;
  head?: string;
  body: string;
  comments: string[];
  image_urls: string[];
  links: PolicyLink[];
  excerpt: string;
  tags: string[];
  source_type: "post" | "seed";
  compact_excerpt?: string;
  policy_rules?: string[];
}

export type PolicyRuleKind = "rule" | "exception" | "procedure" | "bot_command" | "precedent";

export interface PolicyRule {
  rule_id: string;
  source_post_no: string;
  source_type: "post" | "seed";
  source_title: string;
  source_url?: string;
  category: string;
  kind: PolicyRuleKind;
  trigger: string;
  guidance: string;
  quote: string;
  keywords: string[];
  tags: string[];
  search_text: string;
  priority?: number;
}

export interface PolicyCorpus {
  schema_version?: number;
  source: string;
  capturedAt?: string;
  count: number;
  generatedAt: string;
  documents: PolicyDocument[];
  rules?: PolicyRule[];
}

export interface PolicyEvidence {
  rule_id: string;
  source_post_no: string;
  title: string;
  excerpt: string;
  relevance: number;
  tags: string[];
  category?: string;
  kind?: PolicyRuleKind;
  guidance?: string;
  quote?: string;
  source_title?: string;
}

export interface RecommendedAction {
  type: RecommendedActionType;
  label: string;
  rationale: string;
}

export interface PageEvidenceQuote {
  quote: string;
  location: string;
}

export interface PolicyEvidenceQuote {
  source_post_no: string;
  quote: string;
  rule_id: string;
}

export type CommentFightingLikelihood = "low" | "medium" | "high";

export type CommentCliqueLikelihood = "low" | "medium" | "high";

export type CommentNicknameMentionPolicyRisk = "low" | "medium" | "high";

export type CommentCliqueSignalSeverity = "low" | "medium" | "high";

export type CommentCliqueRole =
  | "initiator"
  | "participant"
  | "mentioned_user"
  | "target"
  | "amplifier"
  | "neutral";

export type CommentCliqueSignalType =
  | "nickname_mention_only"
  | "repeated_unnecessary_nickname_mentions"
  | "affectionate_nickname_or_title"
  | "personal_history_reference"
  | "inside_joke"
  | "off_topic_private_chat"
  | "external_private_channel"
  | "specific_user_recruitment"
  | "named_user_fan_service"
  | "clique_or_in_group_language"
  | "staff_favoritism_or_staff_socializing"
  | "accusation_only"
  | "moderation_context"
  | "false_positive_exempt";

export interface CommentCliqueSignal {
  signal_type: CommentCliqueSignalType;
  severity: CommentCliqueSignalSeverity;
  comment_indices: number[];
  user_keys: string[];
  rationale: string;
}

export interface CommentCliqueEvidenceQuote {
  comment_index: number;
  speaker_user_key?: string;
  target_user_key?: string;
  quote: string;
  signal_type: CommentCliqueSignalType;
  severity: CommentCliqueSignalSeverity;
  why_it_matters: string;
}

export type CommentUserRole =
  | "aggressor"
  | "target"
  | "participant"
  | "de-escalator"
  | "neutral"
  | "spam-or-bot";

export type CommentUserRiskLevel = "low" | "watch" | "high";

export interface CommentUserAssessment {
  user_key: string;
  display_name?: string;
  uid?: string;
  ip?: string;
  comment_indices: number[];
  role: CommentUserRole;
  risk_level: CommentUserRiskLevel;
  rationale: string;
  evidence_quotes: string[];
  clique_role?: CommentCliqueRole;
  clique_risk_level?: CommentCliqueLikelihood;
  clique_rationale?: string;
  clique_evidence_quotes?: CommentCliqueEvidenceQuote[];
  clique_fp_exemptions?: string[];
}

export interface CommentThreadAssessment {
  fighting_likelihood: CommentFightingLikelihood;
  fighting_summary: string;
  clique_likelihood?: CommentCliqueLikelihood;
  clique_summary?: string;
  nickname_mention_policy_risk?: CommentNicknameMentionPolicyRisk;
  clique_requires_human_review?: boolean;
  clique_confidence?: number;
  clique_signals?: CommentCliqueSignal[];
  clique_fp_guardrails_applied?: string[];
  per_user: CommentUserAssessment[];
}

export interface JudgmentCard {
  summary: string;
  issue_types: IssueType[];
  matched_rules: PolicyEvidence[];
  llm_reasoning: string;
  uncertainty: string;
  false_positive_risk: string;
  recommended_actions: RecommendedAction[];
  current_page_evidence: PageEvidenceQuote[];
  policy_evidence: PolicyEvidenceQuote[];
  special_bot_command_candidates: string[];
  comment_thread_assessment?: CommentThreadAssessment;
  final_human_decision_required: true;
}

export interface JudgePrompt {
  system: string;
  user: string;
}
