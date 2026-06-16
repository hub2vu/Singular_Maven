import type { ModerationObservation, PolicyCorpus, PolicyDocument, PolicyEvidence, PolicyRule, PolicyRuleKind } from "../../shared/types.js";

const MOD_ANCHOR = /완장|파딱|주딱|딱지|매니저|부매니저|운영진|관리자/u;
const MOD_EXACT = /완장\s*고로시|완장고로시|파딱\s*고로시|파딱고로시|주딱\s*고로시|주딱고로시|운영\s*(방해|흔들)|운영진을\s*흔들|완장\s*수\s*선동|친목완장욕|완장\s*대체|파딱\s*대체|주딱\s*대체|운영진\s*대체/u;
const MOD_ATTACK = /무능|에고|권력남용|천안문|공포정치|근첩|좆목|친목\s*완장|친목완장|네임드화|지우개|롤플레잉|해임|내려가라|내려가야|내려와|내려오|사퇴|관리\s*뭐함|완장\s*뭐함|파딱\s*뭐함|주딱\s*뭐함|니가\s*뭔데|완장질/u;
const MOD_MOBILIZE = /여론|선동|물타기|개추|추천|투표|갤\s*망|망한다|다같이|하루종일|계속|반복|또|파생글|장작|끌올|스크랩/u;
const MOD_SAFE_CONTEXT = /새\s*부매니저|명령어|@특갤봇|특갤봇|완장분들\s*파이팅|파이팅|수고|감사|AI\s*파딱|ai\s*파딱|인공지능\s*파딱|파딱\s*우대|매니저탭|가이드|규정\s*복습|죄송|사과|확인했습니다|완장\s*하지\s*마세요/u;

export interface ModGoroSignal {
  mention: boolean;
  exact: boolean;
  attack: boolean;
  mobilize: boolean;
  safeContext: boolean;
  signal: boolean;
  strongSignal: boolean;
  safeOnly: boolean;
}

function hasNearPair(text: string, left: RegExp, right: RegExp, window = 80): boolean {
  const chars = [...text];
  for (let index = 0; index < chars.length; index += 1) {
    const slice = chars.slice(index, index + window).join("");
    if (left.test(slice) && right.test(slice)) return true;
  }
  return false;
}

export function detectModGoro(text: string): ModGoroSignal {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  const mention = MOD_ANCHOR.test(normalized);
  const exact = MOD_EXACT.test(normalized);
  const attack = hasNearPair(normalized, MOD_ANCHOR, MOD_ATTACK);
  const mobilize = MOD_MOBILIZE.test(normalized);
  const safeContext = MOD_SAFE_CONTEXT.test(normalized);
  const signal = exact || (mention && attack);
  const strongSignal = exact || (mention && attack && mobilize);
  const safeOnly = mention && safeContext && !exact && !attack && !mobilize;
  return { mention, exact, attack, mobilize, safeContext, signal, strongSignal, safeOnly };
}

const ISSUE_KEYWORDS: Record<string, string[]> = {
  "이왜특/갤무관": ["이왜특", "갤무관", "무관", "특이점"],
  "이용약관/법률/사회통념": ["이용 약관", "법률", "불법", "건전한 사회 통념", "사회통념", "개인정보", "신상", "초상권", "저작권"],
  "정떡": ["정떡", "정치", "대통령", "국힘", "민주당", "좌파", "우파"],
  "정치/지역/성별혐오": ["국내외 정치", "정치", "지역드립", "성별 혐오", "성별혐오", "여혐", "남혐", "정책 지지", "정책 조롱"],
  "완장고로시": ["완장고로시", "완장 고로시", "파딱고로시", "파딱 고로시", "주딱고로시", "주딱 고로시", "운영 방해", "운영진을 흔들", "운영 흔들기", "완장 수 선동", "친목완장욕"],
  "닉언/친목/사칭": ["닉언", "닉언콘", "닉네임 언급", "친목질", "친목", "사칭", "네임드화", "사적 친분", "외부 채널", "단톡", "인그룹"],
  "분탕/어그로": ["분탕", "어그로", "꼬투리", "고로시", "갈드컵 유도", "반복 위반", "영구 차단"],
  "종교/음모론": ["종교", "음모론", "자연의 섭리", "짐승의 표", "베리칩", "빌 게이츠", "코로나 백신", "지구 온난화는 허구"],
  "반과학/유사과학": ["반과학", "유사과학", "반지성주의", "직업 비하", "직업 조롱", "전자레인지", "발암물질", "무조건 틀렸다"],
  "선형글/레퍼런스 부족": ["선형글", "레퍼런스 없음", "레퍼런스 없는", "AGI는 불가능", "AGI 불가능", "2045년 이후", "특이점주의에 반하는"],
  "인증/팬보이/갈드컵": ["현직자", "전공자", "구체적 인증", "인증 없이", "팬보이", "갈드컵", "모델 비교", "기업 비교", "비하 의도"],
  "도배기/역류기": ["도배기", "역류기", "도배", "방어", "댓글방어", "게시물방어"],
  "이미지 리스크": ["혐짤", "야짤", "이미지글 삭제", "gif 테러", "혐오 이미지", "짤테러", "이미지 리스크"],
  "수익/홍보/강의팔이": ["홍보", "수익", "강의", "유료"],
  "프로그램 홍보": ["프로그램 홍보", "단순 홍보", "영리 목적", "정보 가치", "동일 프로그램", "최대 2회", "유용한 경우"],
  "주식/코인/투자": ["주식", "주.식", "코인", "코.인", "투자", "매수", "매도", "월가", "버블", "거품", "IPO", "수익률"],
  "국뽕/출산율/혐오떡밥": ["국뽕", "일뽕", "중뽕", "출산율", "혐한", "국까", "떡밥"],
  "타커뮤 캡처/조롱": ["타커뮤", "캡처", "조롱", "펨코", "클리앙"],
  "타갤/타커뮤 언급": ["타 갤러리", "타갤", "타 커뮤니티", "타커뮤", "갤러리 언급", "커뮤니티 언급", "좌표", "침공"],
  "요주의 계정/IP/VPN": ["vpn", "ip", "깡계", "유동", "반고닉", "차단", "저격성 콘사용", "저격성 콘", "저격콘", "반복 콘사용", "고의성 콘", "모르고 사용", "6시간", "7일", "31일"],
  "비관론갤 활동": ["비관론갤", "비관갤", "유사 갤", "활동식별코드", "비관론 주제"],
  "허위사실/이미지 저해": ["허위사실", "가짜 레퍼런스", "이미지 저해", "특정 인물", "특정 집단", "명예훼손", "낚시글"],
  "욕설싸움/분쟁": ["맥락 없는 시비", "시비성 욕설", "상호 욕설", "싸움", "개인 간 분쟁", "분쟁"],
  "금지 떡밥": ["금지 떡밥", "신세한탄", "우울글", "망상글", "완몰가", "체감글", "저격글", "디시콘", "낚시글", "기본소득", "토크나이저", "숫자 비교", "정체불명", "X 찌라시"],
  "개념글 제한": ["개념글 제한", "념글 제한", "신분이 확인되지 않은", "SNS발", "유머 게시글", "분탕 목적", "일침성 게시글", "조작이 의심되는 개념글"],
  "레퍼런스 기준": ["레퍼런스 기준", "OECD", "정부 기관", "대학 교수", "빅테크", "C레벨", "공신력", "논문", "석사", "박사", "제도권 언론", "사설", "기고문"],
  "허용 예외": ["사실에 기반한 완장 비판", "현재 기술", "AI 비판", "기술 비판", "단순 욕설", "삭제 차단 사유가 되지 않습니다"],
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
    "허용 예외",
    "선형글/레퍼런스 부족",
    "레퍼런스 기준",
    "종교/음모론",
    "반과학/유사과학",
    "닉언/친목/사칭",
    "정치/지역/성별혐오",
    "주식/코인/투자",
    "국뽕/출산율/혐오떡밥",
    "타갤/타커뮤 언급",
    "비관론갤 활동",
    "금지 떡밥",
    "허위사실/이미지 저해",
    "개념글 제한",
    "이용약관/법률/사회통념",
    "인증/팬보이/갈드컵",
    "프로그램 홍보",
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
    score += modGoro.strongSignal
      ? (rule.source_type === "seed" ? 10 : 4)
      : 3;
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
