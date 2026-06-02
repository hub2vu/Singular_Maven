import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PolicyCorpus, PolicyDocument, PolicyLink } from "../../shared/types.js";

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
  source?: string;
  capturedAt?: string;
  count?: number;
  posts?: RawPost[];
}

const TAG_KEYWORDS: Record<string, string[]> = {
  "이왜특/갤무관": ["이왜특", "갤무관", "특이점과 무관", "무관한", "뻘글"],
  "정떡": ["정떡", "정치", "대통령", "국힘", "민주당", "좌파", "우파", "정치글"],
  "닉언콘/친목": ["닉언콘", "닉언", "친목", "@", "좆목"],
  "완장고로시": ["완장", "고로시", "파딱", "주딱", "매니저", "부매니저"],
  "도배기/역류기": ["도배기", "역류기", "도배", "공격", "방어", "댓글방어", "게시물방어"],
  "이미지 리스크": ["혐짤", "야짤", "이미지", "캡처", "짤", "gif"],
  "수익/홍보/강의팔이": ["홍보", "수익", "강의", "강의팔이", "리딩방", "유료", "구독", "광고"],
  "타커뮤 캡처/조롱": ["타커뮤", "캡처", "조롱", "펨코", "루리웹", "클리앙", "아카라이브"],
  "요주의 계정/IP/VPN": ["vpn", "ip", "깡계", "유동", "반고닉", "고닉", "차단"],
  "특갤봇 명령 후보": ["@특갤봇", "댓글방어", "게시물방어", "방어("]
};

const SEED_DOCS: Array<Omit<PolicyDocument, "id" | "source_type">> = [
  {
    rule_id: "seed-nickcon-after-2026-06-01",
    source_post_no: "1224888",
    title: "2026-06-01 이후 닉언콘 친목 처리",
    body: "2026-06-01 이후 닉언콘 사용은 친목질로 보고 31일 차단 후보로 검토한다.",
    comments: [],
    image_urls: [],
    links: [],
    excerpt: "2026-06-01 이후 닉언콘은 친목질로 보고 31일 차단 후보.",
    tags: ["닉언콘/친목", "요주의 계정/IP/VPN"]
  },
  {
    rule_id: "seed-nickcon-supporting-posts",
    source_post_no: "1224783",
    title: "닉언콘 관련 보조 근거",
    body: "닉언콘과 친목성 호출은 최신 운영 방침상 강하게 제한한다. 관련 근거 글번호: 1224783, 1224760, 1225924, 1224960, 1216079.",
    comments: [],
    image_urls: [],
    links: [],
    excerpt: "닉언콘과 친목성 호출은 최신 운영 방침상 강하게 제한.",
    tags: ["닉언콘/친목"]
  },
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

function inferTags(text: string, images: RawImage[]): string[] {
  const haystack = text.toLowerCase();
  const tags = Object.entries(TAG_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword.toLowerCase())))
    .map(([tag]) => tag);
  if (images.length > 0 && !tags.includes("이미지 리스크")) {
    tags.push("이미지 리스크");
  }
  return [...new Set(tags)];
}

function postToDocument(post: RawPost): PolicyDocument {
  const sourcePostNo = normalizeText(post.no);
  const comments = (post.comments ?? []).map((comment) => normalizeText([comment.author, comment.date, comment.text].filter(Boolean).join(" "))).filter(Boolean);
  const imageUrls = (post.images ?? []).map((image) => normalizeText(image.src)).filter(Boolean);
  const links = [...(post.bodyLinks ?? []), ...(post.links ?? [])].map((link) => ({
    href: normalizeText(link.href),
    text: normalizeText(link.text)
  })).filter((link) => link.href);
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
    tags: inferTags(fullText, post.images ?? []),
    source_type: "post"
  };
}

export interface IngestPolicyCorpusOptions {
  sourcePath: string;
  outDir?: string;
}

export async function ingestPolicyCorpus(options: IngestPolicyCorpusOptions): Promise<PolicyCorpus> {
  const raw = JSON.parse(await readFile(options.sourcePath, "utf8")) as RawCorpus;
  const posts = raw.posts ?? [];
  const postDocuments = posts.map(postToDocument).filter((doc) => doc.source_post_no);
  const seedDocuments: PolicyDocument[] = SEED_DOCS.map((doc) => ({
    ...doc,
    id: doc.rule_id,
    source_type: "seed"
  }));
  const corpus: PolicyCorpus = {
    source: raw.source ?? options.sourcePath,
    capturedAt: raw.capturedAt,
    count: raw.count ?? posts.length,
    generatedAt: new Date().toISOString(),
    documents: [...postDocuments, ...seedDocuments]
  };

  if (options.outDir) {
    await mkdir(options.outDir, { recursive: true });
    await writeFile(path.join(options.outDir, "policy-index.json"), JSON.stringify(corpus, null, 2), "utf8");
  }

  return corpus;
}
