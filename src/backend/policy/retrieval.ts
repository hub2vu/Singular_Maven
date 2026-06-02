import type { ModerationObservation, PolicyCorpus, PolicyDocument, PolicyEvidence, PolicyRule, PolicyRuleKind } from "../../shared/types.js";
import { detectModGoro } from "./modGoro.js";

const ISSUE_KEYWORDS: Record<string, string[]> = {
  "이왜특/갤무관": ["이왜특", "갤무관", "무관", "특이점"],
  "정떡": ["정떡", "정치", "대통령", "국힘", "민주당", "좌파", "우파"],
  "완장고로시": ["완장고로시", "완장 고로시", "파딱고로시", "파딱 고로시", "주딱고로시", "주딱 고로시", "운영 방해", "운영진을 흔들", "운영 흔들기", "완장 수 선동", "친목완장욕"],
  "도배기/역류기": ["도배기", "역류기", "도배", "방어", "댓글방어", "게시물방어"],
  "이미지 리스크": ["혐짤", "야짤", "이미지글 삭제", "gif 테러", "혐오 이미지", "짤테러", "이미지 리스크"],
  "수익/홍보/강의팔이": ["홍보", "수익", "강의", "유료"],
  "타커뮤 캡처/조롱": ["타커뮤", "캡처", "조롱", "펨코", "클리앙"],
  "요주의 계정/IP/VPN": ["vpn", "ip", "깡계", "유동", "반고닉", "차단"],
  "특갤봇 명령 후보": ["@특갤봇", "@특갤에이전트", "댓글방어", "게시물방어", "방어("]
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}@]+/gu)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
  );
}

function compactText(value: unknown, max = 180): string {
  const normalized = String(value ?? "").replace(/https?:\/\/\S+/giu, " ").replace(/\s+/gu, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function observationText(observation: ModerationObservation): string {
  const comments = observation.comments.slice(0, 50).map((comment) => [
    comment.author,
    comment.authorIdentity?.name,
    comment.authorIdentity?.uid,
    comment.authorIdentity?.ip,
    comment.text
  ].filter(Boolean).join(" ")).join("\n");
  const imageContext = observation.images.map((image) => `${image.alt ?? ""} ${image.nearbyText ?? ""}`).join("\n");
  const linkText = observation.links.map((link) => link.text ?? "").join("\n");
  const primary = [
    observation.title,
    observation.galleryId,
    observation.postNo,
    observation.head,
    observation.author?.name,
    observation.author?.uid,
    observation.author?.ip,
    observation.createdAtText,
    observation.bodyText,
    observation.selectedText,
    comments,
    imageContext,
    linkText
  ]
    .filter(Boolean)
    .join("\n");

  return [primary, primary.trim() ? "" : observation.viewportText].filter(Boolean).join("\n");
}

function inferQueryTags(text: string): string[] {
  const haystack = text.toLowerCase();
  const tags = Object.entries(ISSUE_KEYWORDS)
    .filter(([tag]) => tag !== "완장고로시")
    .filter(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword.toLowerCase())))
    .map(([tag]) => tag);
  if (detectModGoro(text).signal) tags.push("완장고로시");
  return [...new Set(tags)];
}

function categoryForTags(tags: string[]): string {
  const priority = [
    "특갤봇 명령 후보",
    "이미지 리스크",
    "도배기/역류기",
    "완장고로시",
    "정떡",
    "수익/홍보/강의팔이",
    "이왜특/갤무관",
    "타커뮤 캡처/조롱",
    "요주의 계정/IP/VPN"
  ];
  return priority.find((tag) => tags.includes(tag)) ?? tags[0] ?? "운영 근거";
}

function kindForDocument(doc: PolicyDocument, category: string): PolicyRuleKind {
  const text = `${doc.title} ${doc.body} ${doc.excerpt} ${doc.comments.slice(0, 5).join(" ")} ${doc.tags.join(" ")}`;
  if (category === "특갤봇 명령 후보" || /@특갤봇|@특갤에이전트|댓글방어|게시물방어|방어\(/u.test(text)) return "bot_command";
  if (/예외|허용|보류|오탐/u.test(text)) return "exception";
  if (/방법|절차|명령|공지|확인|검토/u.test(text)) return "procedure";
  if (doc.source_type === "post") return "precedent";
  return "rule";
}

function ruleFromDocument(doc: PolicyDocument): PolicyRule {
  const category = categoryForTags(doc.tags);
  const kind = kindForDocument(doc, category);
  const guidance = kind === "bot_command" && doc.source_post_no === "1226405"
    ? "@특갤봇 게시물방어(n), 댓글방어(n), 방어(n)의 n은 1~10 정수 범위로만 제안한다."
    : compactText(doc.compact_excerpt || doc.excerpt || doc.body || doc.title, 180);
  return {
    rule_id: `${doc.rule_id}#compact`,
    source_post_no: doc.source_post_no,
    source_type: doc.source_type,
    source_title: doc.title,
    source_url: doc.url,
    category,
    kind,
    trigger: compactText([doc.title, doc.head, doc.tags.join(" ")].filter(Boolean).join(" · "), 120),
    guidance,
    quote: compactText(doc.excerpt || doc.body || doc.comments[0] || doc.title, 180),
    keywords: [...new Set([...doc.tags, ...doc.title.split(/[^\p{L}\p{N}@]+/gu).filter((token) => token.length > 1)])].slice(0, 18),
    tags: doc.tags,
    search_text: compactText([doc.title, doc.head, doc.body, doc.excerpt, doc.comments.slice(0, 30).join("\n"), doc.tags.join(" ")].filter(Boolean).join("\n"), 1600),
    priority: doc.source_type === "seed" ? 2 : 1
  };
}

function rulesForCorpus(corpus: PolicyCorpus): PolicyRule[] {
  if (Array.isArray(corpus.rules) && corpus.rules.length) return corpus.rules;
  return corpus.documents.map(ruleFromDocument);
}

function scoreRule(rule: PolicyRule, queryTokens: Set<string>, queryTags: string[], rawQuery: string): number {
  const rawLower = rawQuery.toLowerCase();
  const modGoro = detectModGoro(rawQuery);
  if (rule.category === "완장고로시" && (modGoro.safeOnly || !modGoro.signal)) {
    return 0;
  }
  const ruleText = [
    rule.source_title,
    rule.category,
    rule.kind,
    rule.trigger,
    rule.guidance,
    rule.quote,
    rule.keywords.join(" "),
    rule.tags.join(" "),
    rule.search_text
  ].join("\n");
  const ruleTextLower = ruleText.toLowerCase();
  const ruleTokens = tokenize(ruleText);
  let score = 0;

  for (const token of queryTokens) {
    if (ruleTokens.has(token)) {
      score += token.length >= 4 ? 1.2 : 0.8;
    } else if (token.length >= 4 && ruleTextLower.includes(token)) {
      score += 0.35;
    }
  }

  for (const tag of queryTags) {
    if (rule.category === tag || rule.tags.includes(tag)) {
      score += rule.source_type === "seed" ? 8 : 3.2;
    }
  }

  for (const keyword of rule.keywords) {
    if (keyword.length > 1 && rawLower.includes(keyword.toLowerCase())) score += 1.5;
  }

  if (rule.category === "완장고로시" && modGoro.signal) {
    const guardrail = rule.kind === "exception" || rule.tags.includes("오탐방지");
    score += modGoro.strongSignal
      ? (rule.source_type === "seed" ? 10 : 4)
      : (guardrail ? 6 : 3);
  }

  if (/@특갤봇|@특갤에이전트/u.test(rawQuery) && rule.category === "특갤봇 명령 후보") score += 9;
  if (/댓글방어|게시물방어|방어\(/u.test(rawQuery) && rule.source_post_no === "1226405") score += 10;
  if (rawQuery.includes(rule.source_post_no)) score += 6;
  score += (rule.priority ?? 1) * 0.2;
  return score;
}

function clampRelevance(score: number, topScore: number): number {
  if (topScore <= 0) return 0;
  return Number(Math.max(0.1, Math.min(0.99, score / topScore)).toFixed(2));
}

function hasEnoughSignal(score: number, topScore: number): boolean {
  return score >= 1.5 || (score >= 0.8 && topScore > 0 && score / topScore >= 0.18);
}

function selectDiverse(scored: Array<{ rule: PolicyRule; score: number }>, limit: number): Array<{ rule: PolicyRule; score: number }> {
  const selected: Array<{ rule: PolicyRule; score: number }> = [];
  const selectedIds = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  for (const item of scored) {
    const sourceCount = sourceCounts.get(item.rule.source_post_no) ?? 0;
    const categoryCount = categoryCounts.get(item.rule.category) ?? 0;
    if (sourceCount >= 2 || categoryCount >= 3) continue;
    selected.push(item);
    selectedIds.add(item.rule.rule_id);
    sourceCounts.set(item.rule.source_post_no, sourceCount + 1);
    categoryCounts.set(item.rule.category, categoryCount + 1);
    if (selected.length >= limit) return selected;
  }

  for (const item of scored) {
    if (selectedIds.has(item.rule.rule_id)) continue;
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function retrievePolicyEvidence(corpus: PolicyCorpus, observation: ModerationObservation, limit = 10): PolicyEvidence[] {
  const rawQuery = observationText(observation);
  const queryTokens = tokenize(rawQuery);
  const queryTags = inferQueryTags(rawQuery);
  const allScored = rulesForCorpus(corpus)
    .map((rule) => ({ rule, score: scoreRule(rule, queryTokens, queryTags, rawQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.rule.source_post_no.localeCompare(b.rule.source_post_no));
  const topScore = allScored[0]?.score ?? 1;
  const scored = allScored.filter((item) => hasEnoughSignal(item.score, topScore));

  return selectDiverse(scored, limit).map(({ rule, score }) => ({
    rule_id: rule.rule_id,
    source_post_no: rule.source_post_no,
    title: rule.source_title,
    source_title: rule.source_title,
    excerpt: compactText(rule.guidance || rule.quote || rule.search_text, 220),
    category: rule.category,
    kind: rule.kind,
    guidance: compactText(rule.guidance, 180),
    quote: compactText(rule.quote, 180),
    relevance: clampRelevance(score, topScore),
    tags: rule.tags
  }));
}
