import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PolicyCorpus, PolicyDocument, PolicyLink, PolicyRule, PolicyRuleKind } from "../../shared/types.js";
import { detectModGoro } from "./modGoro.js";

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
  "완장고로시": ["완장고로시", "완장 고로시", "파딱고로시", "파딱 고로시", "주딱고로시", "주딱 고로시", "운영 방해", "운영진을 흔들", "운영 흔들기", "완장 수 선동", "친목완장욕"],
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
    rule_id: "seed-mod-complaint-channel-vs-goro",
    source_post_no: "1043170",
    title: "완장고로시: 민원 창구와 운영 흔들기 구분",
    body: "공지 댓글, 신문고, 방명록의 정중한 민원은 대응한다. 반대로 유동/깡계가 뜬금없이 게시글로 완장, 운영, 차단을 싸잡아 흔드는 경우는 삭제·차단 후보로 본다.",
    comments: ["검색 키워드: 완장고로시 운영 흔들기 차단이 어쩌니 유동 깡계 신문고 방명록"],
    image_urls: [],
    links: [],
    excerpt: "정중한 민원은 대응하되, 유동/깡계의 돌발 운영 흔들기는 병먹금·삭제·차단 후보.",
    tags: ["완장고로시", "오탐방지", "요주의 계정/IP/VPN"]
  },
  {
    rule_id: "seed-mod-longtime-user-leniency",
    source_post_no: "925024",
    title: "오래 활동한 고닉/유동은 기계적으로 잡지 않음",
    body: "오래 활동한 고닉이나 유동 IP는 적당히 커트라인을 봐주고 댓글 경고 등으로 처리한다. 깡계정이나 갤 방향성과 반대되는 글은 더 강하게 처리한다. 완장 활동은 무색무취하게 한다.",
    comments: ["검색 키워드: 오래 활동한 고닉 기계적 차단 금지 무색무취 댓글 경고 깡계"],
    image_urls: [],
    links: [],
    excerpt: "고닉/장기 유저는 우선 유도리 있게, 깡계·분탕성은 강하게. 완장은 무색무취.",
    tags: ["완장고로시", "오탐방지", "운영 원칙"]
  },
  {
    rule_id: "seed-mod-behavior-during-heated-topics",
    source_post_no: "1226361",
    title: "완장 행동 원칙: 과열 시 공지 후 제한",
    body: "완장은 어수선한 분위기에서 필요 이상의 발언, 동조 댓글, 갈드컵 편승을 피한다. 갤 무관·과열 주제는 HH:MM 이후 제한 공지와 짧은 유예 후 삭제하고, 과한 어그로·분탕만 차단한다.",
    comments: ["검색 키워드: 완장 입 무겁게 갈드컵 편승 공지 후 제한 5분 유예 과열 떡밥"],
    image_urls: [],
    links: [],
    excerpt: "완장은 입이 무겁게. 과열 주제는 공지+유예 후 제한, 분탕만 차단.",
    tags: ["완장고로시", "운영 원칙"]
  },
  {
    rule_id: "seed-mod-factual-criticism-allowed",
    source_post_no: "1133372",
    title: "사실 기반 완장 비판은 허용하되 근거 없는 비난은 경계",
    body: "사실에 기반한 완장 비판은 삭제·차단 사유가 아니다. 다만 개인 불만성 워딩, 근거 없는 비난, 노예취급성 표현이 반복되면 별도 규정과 조치가 필요할 수 있다.",
    comments: ["검색 키워드: 사실 기반 완장 비판 근거 없는 비난 관리 피로 오탐 정당한 비판"],
    image_urls: [],
    links: [],
    excerpt: "사실 기반 비판은 허용. 근거 없는 비난과 반복 불만은 관찰·누적.",
    tags: ["완장고로시", "오탐방지", "운영비판 허용"]
  },
  {
    rule_id: "seed-mod-lead-intervention-line",
    source_post_no: "1096979",
    title: "주딱 개입선: 파딱고로시가 갤 떡밥화될 때",
    body: "주딱은 큰 사건, 파딱 고로시 떡밥화, 타갤 침공, 갤 담론과 성질이 다른 이슈가 주류가 될 때 개입한다. 평소 자잘한 과열은 파딱이 정리한다.",
    comments: ["검색 키워드: 파딱 고로시 주딱 개입 타갤 침공 갤 떡밥 운영 흔들기"],
    image_urls: [],
    links: [],
    excerpt: "파딱고로시가 갤 떡밥이 되거나 타갤 침공이 있으면 주딱 개입.",
    tags: ["완장고로시", "운영 원칙", "타커뮤 캡처/조롱"]
  },
  {
    rule_id: "seed-mod-repeated-frame-escalation",
    source_post_no: "1193437",
    title: "반복 완장 불만은 파생글·댓글·고로시로 번지는지 본다",
    body: "단건 비판은 허용되지만, 같은 유저가 완장 에고, 친목, 네임드화 프레임을 반복하고 파생 댓글·파생글을 유도하면 완장고로시로 승격한다.",
    comments: ["검색 키워드: 완장 에고 친목 네임드화 파생글 불만여론 천안문"],
    image_urls: [],
    links: [],
    excerpt: "단건 비판이 아니라 반복 프레임, 파생글, 파생 댓글로 번지는지가 핵심.",
    tags: ["완장고로시", "반복여론몰이", "친목/네임드화"]
  },
  {
    rule_id: "seed-mod-criticism-vs-destabilization",
    source_post_no: "1201345",
    title: "완장비판 허용과 운영진 흔들기 구분",
    body: "완장비판은 공지상 허용되지만, 사실 여부와 별개로 운영진을 흔들 정도의 언행은 바로잡을 필요가 있다. 항의 시에는 단순 비판인지 운영 방해인지 분리해 설명한다.",
    comments: ["검색 키워드: 완장비판 허용 운영진을 흔들 운영 방해 항의 대응"],
    image_urls: [],
    links: [],
    excerpt: "완장비판은 허용. 운영진을 흔들 정도의 언행은 운영 방해로 별도 판단.",
    tags: ["완장고로시", "오탐방지", "운영 방해"]
  },
  {
    rule_id: "seed-mod-repeated-evidence-case",
    source_post_no: "1201546",
    title: "반복 프레임 증거 정리: 단건 비판과 누적 운영 방해 구분",
    body: "떡밥 통제 불만, 파딱 네임드화, 공포정치, AI로 완장 대체, 완장 에고 등 여러 프레임을 반복한 경우 단건 비판이 아니라 누적 운영 방해로 본다.",
    comments: ["검색 키워드: 공포정치 완장 에고 AI 완장 파딱 네임드화 반복 불만"],
    image_urls: [],
    links: [],
    excerpt: "여러 완장 비난 프레임이 반복되면 증거를 묶어 운영 방해로 판단.",
    tags: ["완장고로시", "케이스증거", "반복여론몰이"]
  },
  {
    rule_id: "seed-mod-escalation-levels",
    source_post_no: "1194950",
    title: "완장고로시 제재는 단계적으로: 경고·단기·31일",
    body: "갱차가 과할 수 있는 경우 경고성 1일, 7일, 31일 등 단계 처리를 검토한다. 차단 사유는 운영 방해 경고처럼 항고 대응 가능한 문구로 남긴다.",
    comments: ["검색 키워드: 1일 차단 7일 차단 31일 운영 방해 경고 갱차는 과함"],
    image_urls: [],
    links: [],
    excerpt: "바로 갱차보다 경고성 단기 차단 후 반복 시 강화.",
    tags: ["완장고로시", "제재수위", "오탐방지"]
  },
  {
    rule_id: "seed-mod-identical-frame-ip-shift",
    source_post_no: "1162503",
    title: "동일 문구·IP 변경 선동은 완장고로시 고위험 신호",
    body: "토씨 하나 안 틀린 글이 IP만 바뀌어 반복되면 단순 비판이 아니라 선동·분탕 레퍼런스로 저장한다. 이후 유사 여론이 형성되면 강한 근거로 사용한다.",
    comments: ["검색 키워드: 완장 수 선동 IP만 바꿈 토씨 하나 동일 문구 여론 만들기"],
    image_urls: [],
    links: [],
    excerpt: "동일 문구 반복+IP 변경은 선동/분탕 신호.",
    tags: ["완장고로시", "선동", "요주의 계정/IP/VPN"]
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

function inferTags(text: string, modText = text): string[] {
  const haystack = text.toLowerCase();
  const tags = Object.entries(TAG_KEYWORDS)
    .filter(([tag]) => tag !== "완장고로시")
    .filter(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword.toLowerCase())))
    .map(([tag]) => tag);
  const modGoro = detectModGoro(modText);
  if (modGoro.exact || (modGoro.strongSignal && !modGoro.safeContext)) {
    tags.push("완장고로시");
  }
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
  const modTagText = [tagText, comments.slice(0, 30).join("\n")].map(normalizeText).join("\n");
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
    tags: inferTags(tagText, modTagText),
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
