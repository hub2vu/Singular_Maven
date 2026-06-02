export type IssueType =
  | "이왜특/갤무관"
  | "정떡"
  | "완장고로시"
  | "도배기/역류기"
  | "이미지 리스크"
  | "수익/홍보/강의팔이"
  | "타커뮤 캡처/조롱"
  | "요주의 계정/IP/VPN"
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
}

export interface PolicyCorpus {
  source: string;
  capturedAt?: string;
  count: number;
  generatedAt: string;
  documents: PolicyDocument[];
}

export interface PolicyEvidence {
  rule_id: string;
  source_post_no: string;
  title: string;
  excerpt: string;
  relevance: number;
  tags: string[];
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
  final_human_decision_required: true;
}

export interface JudgePrompt {
  system: string;
  user: string;
}
