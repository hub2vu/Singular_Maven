import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PolicyCorpus, PolicyDocument, PolicyLink, PolicyRule, PolicyRuleKind } from "../../shared/types.js";

interface RawComment {
  author?: string;
  date?: string;
  id?: string;
  text?: string;
}

interface RawImage {
  src?: string;
  alt?: string;
}

interface RawPost {
  no?: string | number;
  title?: string;
  body?: string;
  author?: string;
  date?: string;
  head?: string;
  href?: string;
  url?: string;
  comments?: RawComment[];
  images?: RawImage[];
  bodyLinks?: PolicyLink[];
  links?: PolicyLink[];
  metaText?: string;
}

interface RawCorpus {
  schema_version?: number;
  source?: string;
  capturedAt?: string;
  count?: number;
  posts?: RawPost[];
  generatedAt?: string;
  documents?: PolicyDocument[];
  rules?: PolicyRule[];
}

const TAG_KEYWORDS: Record<string, string[]> = {
  "이왜특/갤무관": ["이왜특", "갤무관", "특이점과 무관", "무관한", "뻘글"],
  "정떡": ["정떡", "정치", "대통령", "국힘", "민주당", "좌파", "우파", "정치글"],
  "완장고로시": ["완장고로시", "운영진 공격", "완장 욕", "파딱 욕", "주딱 욕", "친목완장욕", "관리자 공격"],
  "도배기/역류기": ["도배기", "역류기", "도배", "공격", "방어", "댓글방어", "게시물방어"],
  "이미지 리스크": ["혐짤", "야짤", "이미지글 삭제", "gif 테러", "혐오 이미지", "짤테러", "이미지 리스크"],
  "수익/홍보/강의팔이": ["홍보", "수익", "강의", "강의팔이", "리딩방", "유료", "구독"],
  "타커뮤 캡처/조롱": ["타커뮤", "캡처", "조롱", "펨코", "루리웹", "클리앙", "아카라이브"],
  "요주의 계정/IP/VPN": ["vpn", "ip", "깡계", "유동", "반고닉", "고닉", "차단"],
  "특갤봇 명령 후보": ["@특갤봇", "댓글방어", "게시물방어", "방어("]
};

const SEED_DOCS: Array<Omit<PolicyDocument, "id" | "source_type">> = [
  {
    rule_id: "seed-bot-defense-range",
    source_post_no: "1226405",
    title: "특갤봇 방어 명령 n 범위",
    body: "@특갤봇 게시물방어(n), 댓글방어(n), 방어(n)의 n은 1~10 정수만 허용한다.",
    comments: [],
    image_urls: [],
    links: [],
    excerpt: "@특갤봇 게시물방어(n), 댓글방어(n), 방어(n)의 n은 1~10.",
    tags: ["특갤봇 명령 후보", "도배기/역류기"]
  },
  {
    rule_id: "seed-bot-post-push",
    source_post_no: "1206943",
    title: "특갤봇 특정 글 밀어내기 명령",
    body: "@특갤봇 게시물번호는 특정 글을 직접 삭제하기보다 다른 글을 끌어올려 문제 글을 밀어내는 후보 명령이다.",
    comments: [],
    image_urls: [],
    links: [],
    excerpt: "@특갤봇 게시물번호는 특정 글 밀어내기 후보.",
    tags: ["특갤봇 명령 후보", "도배기/역류기"]
  },
  {
    rule_id: "seed-spam-tool-evidence",
    source_post_no: "1115860",
    title: "도배기/역류기 대응 근거",
    body: "도배기와 역류기 공격은 자동 탐지만으로 단정하지 말고 관리자가 패턴, 반복성, 계정 상태를 함께 확인한다.",
    comments: [],
    image_urls: [],
    links: [],
    excerpt: "도배기/역류기 공격은 패턴, 반복성, 계정 상태를 함께 확인.",
    tags: ["도배기/역류기", "요주의 계정/IP/VPN"]
  },
  {
    rule_id: "seed-mod-attack-evidence",
    source_post_no: "1226361",
    title: "완장고로시 및 운영진 공격 대응",
    body: "완장고로시, 과도한 운영진 공격, 갈드컵 유도는 갤 분위기 훼손 여부를 보고 조치 후보로 검토한다.",
    comments: [],
    image_urls: [],
    links: [],
    excerpt: "완장고로시와 과도한 운영진 공격은 갤 분위기 훼손 여부를 본다.",
    tags: ["완장고로시"]
  },
  {
    rule_id: "seed-offtopic-politics-promo-image",
    source_post_no: "1187315",
    title: "이왜특/정떡/홍보/이미지 리스크 일반 근거",
    body: "기술적 특이점과 무관한 이왜특, 정떡, 혐짤 이미지, 홍보/수익/강의팔이 글은 현재 페이지 맥락과 운영 근거를 함께 비교한다.",
    comments: [],
    image_urls: [],
    links: [],
    excerpt: "이왜특, 정떡, 혐짤 이미지, 홍보/수익/강의팔이는 맥락과 운영 근거를 함께 비교.",
    tags: ["이왜특/갤무관", "정떡", "이미지 리스크", "수익/홍보/강의팔이"]
  }
];

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function makeExcerpt(text: string, max = 420): string {
  const normalized = normalizeText(text);
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function compactText(value: unknown, max = 180): string {
  const normalized = normalizeText(value).replace(/https?:\/\/\S+/giu, " ").replace(/\s+/gu, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function inferTags(text: string): string[] {
  const haystack = text.toLowerCase();
  const tags = Object.entries(TAG_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword.toLowerCase())))
    .map(([tag]) => tag);
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

function keywordsForDocument(doc: PolicyDocument): string[] {
  const text = `${doc.title} ${doc.head ?? ""} ${doc.body} ${doc.excerpt} ${doc.tags.join(" ")}`;
  const keywordHits = Object.values(TAG_KEYWORDS).flat().filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
  const titleTokens = doc.title
    .split(/[^\p{L}\p{N}@]+/gu)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .slice(0, 8);
  return [...new Set([...doc.tags, ...keywordHits, ...titleTokens])].slice(0, 18);
}

function policyRuleFromDocument(doc: PolicyDocument): PolicyRule {
  const category = categoryForTags(doc.tags);
  const kind = kindForDocument(doc, category);
  const quote = compactText(doc.excerpt || doc.body || doc.comments[0] || doc.title, 180);
  const guidance = kind === "bot_command" && doc.source_post_no === "1226405"
    ? "@특갤봇 게시물방어(n), 댓글방어(n), 방어(n)의 n은 1~10 정수 범위로만 제안한다."
    : compactText(doc.excerpt || doc.body || doc.title, 180);
  const trigger = compactText([doc.title, doc.head, doc.tags.join(" ")].filter(Boolean).join(" · "), 120);
  const searchText = compactText([
    doc.title,
    doc.head,
    doc.body,
    doc.excerpt,
    doc.comments.slice(0, 30).join("\n"),
    doc.links.map((link) => link.text).filter(Boolean).join(" "),
    doc.tags.join(" ")
  ].filter(Boolean).join("\n"), 1600);

  return {
    rule_id: `${doc.rule_id}#compact`,
    source_post_no: doc.source_post_no,
    source_type: doc.source_type,
    source_title: doc.title,
    source_url: doc.url,
    category,
    kind,
    trigger,
    guidance,
    quote,
    keywords: keywordsForDocument(doc),
    tags: doc.tags,
    search_text: searchText,
    priority: doc.source_type === "seed" ? 2 : 1
  };
}

function normalizePolicyDocument(doc: PolicyDocument): PolicyDocument {
  const comments = Array.isArray(doc.comments) ? doc.comments.map(normalizeText).filter(Boolean) : [];
  const links = Array.isArray(doc.links)
    ? doc.links.map((link) => ({ href: normalizeText(link.href), text: normalizeText(link.text) })).filter((link) => link.href)
    : [];
  const imageUrls = Array.isArray(doc.image_urls) ? doc.image_urls.map(normalizeText).filter(Boolean) : [];
  return {
    ...doc,
    id: normalizeText(doc.id || doc.rule_id || doc.source_post_no),
    rule_id: normalizeText(doc.rule_id || doc.id || doc.source_post_no),
    source_post_no: normalizeText(doc.source_post_no),
    title: normalizeText(doc.title) || `(untitled ${normalizeText(doc.source_post_no)})`,
    author: normalizeText(doc.author),
    date: normalizeText(doc.date),
    url: normalizeText(doc.url),
    head: normalizeText(doc.head),
    body: normalizeText(doc.body),
    comments,
    image_urls: imageUrls,
    links,
    excerpt: makeExcerpt(doc.excerpt || [doc.title, doc.head, doc.body, comments.join("\n")].join("\n")),
    tags: Array.isArray(doc.tags) ? [...new Set(doc.tags.map(normalizeText).filter(Boolean))] : [],
    source_type: doc.source_type === "seed" ? "seed" : "post"
  };
}

function withCompactRules(corpus: PolicyCorpus): PolicyCorpus {
  const documents = corpus.documents.map(normalizePolicyDocument).filter((doc) => doc.source_post_no);
  const rules = documents.map(policyRuleFromDocument);
  const documentsWithRuleRefs = documents.map((doc, index) => ({
    ...doc,
    compact_excerpt: rules[index]?.guidance,
    policy_rules: rules[index] ? [rules[index].rule_id] : []
  }));
  return {
    ...corpus,
    schema_version: 2,
    count: corpus.count ?? documents.length,
    documents: documentsWithRuleRefs,
    rules
  };
}

function postToDocument(post: RawPost): PolicyDocument {
  const sourcePostNo = normalizeText(post.no);
  const comments = (post.comments ?? []).map((comment) => normalizeText([comment.author, comment.date, comment.text].filter(Boolean).join(" "))).filter(Boolean);
  const imageUrls = (post.images ?? []).map((image) => normalizeText(image.src)).filter(Boolean);
  const links = [...(post.bodyLinks ?? []), ...(post.links ?? [])].map((link) => ({
    href: normalizeText(link.href),
    text: normalizeText(link.text)
  })).filter((link) => link.href);
  const tagText = [post.title, post.head, post.body || post.metaText].map(normalizeText).join("\n");
  const fullText = [post.title, post.head, post.body, comments.join("\n"), links.map((link) => `${link.text} ${link.href}`).join("\n")].map(normalizeText).join("\n");

  return {
    id: `post-${sourcePostNo}`,
    rule_id: `post-${sourcePostNo}`,
    source_post_no: sourcePostNo,
    title: normalizeText(post.title) || `(untitled ${sourcePostNo})`,
    author: normalizeText(post.author),
    date: normalizeText(post.date),
    url: normalizeText(post.url || post.href),
    head: normalizeText(post.head),
    body: normalizeText(post.body || post.metaText),
    comments,
    image_urls: imageUrls,
    links,
    excerpt: makeExcerpt(fullText),
    tags: inferTags(tagText),
    source_type: "post"
  };
}

export interface IngestPolicyCorpusOptions {
  sourcePath: string;
  outDir?: string;
}

export async function ingestPolicyCorpus(options: IngestPolicyCorpusOptions): Promise<PolicyCorpus> {
  const raw = JSON.parse(await readFile(options.sourcePath, "utf8")) as RawCorpus;
  if (Array.isArray(raw.documents)) {
    const corpus = withCompactRules({
      source: raw.source ?? options.sourcePath,
      capturedAt: raw.capturedAt,
      count: raw.count ?? raw.documents.length,
      generatedAt: raw.generatedAt ?? new Date().toISOString(),
      documents: raw.documents
    });

    if (options.outDir) {
      await mkdir(options.outDir, { recursive: true });
      await writeFile(path.join(options.outDir, "policy-index.json"), JSON.stringify(corpus, null, 2), "utf8");
    }

    return corpus;
  }

  const posts = raw.posts ?? [];
  const postDocuments = posts.map(postToDocument).filter((doc) => doc.source_post_no);
  const seedDocuments: PolicyDocument[] = SEED_DOCS.map((doc) => ({
    ...doc,
    id: doc.rule_id,
    source_type: "seed"
  }));
  const corpus = withCompactRules({
    source: raw.source ?? options.sourcePath,
    capturedAt: raw.capturedAt,
    count: raw.count ?? posts.length,
    generatedAt: new Date().toISOString(),
    documents: [...postDocuments, ...seedDocuments]
  });

  if (options.outDir) {
    await mkdir(options.outDir, { recursive: true });
    await writeFile(path.join(options.outDir, "policy-index.json"), JSON.stringify(corpus, null, 2), "utf8");
  }

  return corpus;
}
