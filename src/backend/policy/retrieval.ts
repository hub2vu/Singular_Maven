import type { ModerationObservation, PolicyCorpus, PolicyDocument, PolicyEvidence } from "../../shared/types.js";

const ISSUE_KEYWORDS: Record<string, string[]> = {
  "이왜특/갤무관": ["이왜특", "갤무관", "무관", "특이점"],
  "정떡": ["정떡", "정치", "대통령", "국힘", "민주당", "좌파", "우파"],
  "완장고로시": ["완장", "고로시", "파딱", "주딱", "매니저", "부매니저"],
  "도배기/역류기": ["도배기", "역류기", "도배", "방어", "댓글방어", "게시물방어"],
  "이미지 리스크": ["혐짤", "이미지", "캡처", "짤"],
  "수익/홍보/강의팔이": ["홍보", "수익", "강의", "유료", "광고"],
  "타커뮤 캡처/조롱": ["타커뮤", "캡처", "조롱", "펨코", "클리앙"],
  "요주의 계정/IP/VPN": ["vpn", "ip", "깡계", "유동", "반고닉", "차단"],
  "특갤봇 명령 후보": ["@특갤봇", "댓글방어", "게시물방어", "방어("]
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

function observationText(observation: ModerationObservation): string {
  return [
    observation.url,
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
    observation.viewportText,
    observation.comments.map((comment) => `${comment.author ?? ""} ${comment.text}`).join("\n"),
    observation.images.map((image) => `${image.alt ?? ""} ${image.nearbyText ?? ""} ${image.src}`).join("\n"),
    observation.links.map((link) => `${link.text ?? ""} ${link.href}`).join("\n")
  ]
    .filter(Boolean)
    .join("\n");
}

function inferQueryTags(text: string): string[] {
  const haystack = text.toLowerCase();
  return Object.entries(ISSUE_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword.toLowerCase())))
    .map(([tag]) => tag);
}

function scoreDocument(doc: PolicyDocument, queryTokens: Set<string>, queryTags: string[], rawQuery: string): number {
  const docText = [doc.title, doc.body, doc.comments.join("\n"), doc.excerpt, doc.tags.join(" ")].join("\n");
  const docTokens = tokenize(docText);
  let score = 0;
  for (const token of queryTokens) {
    if (docTokens.has(token)) score += 1;
  }
  for (const tag of queryTags) {
    if (doc.tags.includes(tag)) score += doc.source_type === "seed" ? 10 : 2.5;
  }
  if (rawQuery.includes("@특갤봇") && doc.tags.includes("특갤봇 명령 후보")) score += 8;
  if (/댓글방어|게시물방어|방어\(/u.test(rawQuery) && doc.source_post_no === "1226405") score += 8;
  if (rawQuery.includes(doc.source_post_no)) score += 6;
  return score;
}

function clampRelevance(score: number, topScore: number): number {
  if (topScore <= 0) return 0;
  return Number(Math.max(0.1, Math.min(0.99, score / topScore)).toFixed(2));
}

export function retrievePolicyEvidence(corpus: PolicyCorpus, observation: ModerationObservation, limit = 10): PolicyEvidence[] {
  const rawQuery = observationText(observation);
  const queryTokens = tokenize(rawQuery);
  const queryTags = inferQueryTags(rawQuery);
  const scored = corpus.documents
    .map((doc) => ({ doc, score: scoreDocument(doc, queryTokens, queryTags, rawQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.source_post_no.localeCompare(b.doc.source_post_no));
  const topScore = scored[0]?.score ?? 1;

  return scored.slice(0, limit).map(({ doc, score }) => ({
    rule_id: doc.rule_id,
    source_post_no: doc.source_post_no,
    title: doc.title,
    excerpt: doc.excerpt,
    relevance: clampRelevance(score, topScore),
    tags: doc.tags
  }));
}
