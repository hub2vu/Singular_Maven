import { readFile } from "node:fs/promises";
import type { PolicyCorpus, PolicyDocument, PolicyLink, PolicyRule, PolicyRuleKind } from "../../shared/types.js";
import { detectModGoro } from "./retrieval.js";

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
  "이용약관/법률/사회통념": ["이용 약관", "법률", "불법", "건전한 사회 통념", "사회통념", "개인정보", "신상", "초상권", "저작권"],
  "정떡": ["정떡", "정치", "대통령", "국힘", "민주당", "좌파", "우파", "정치글"],
  "정치/지역/성별혐오": ["국내외 정치", "정치", "지역드립", "성별 혐오", "성별혐오", "여혐", "남혐", "정책 지지", "정책 조롱"],
  "완장고로시": ["완장고로시", "완장 고로시", "파딱고로시", "파딱 고로시", "주딱고로시", "주딱 고로시", "운영 방해", "운영진을 흔들", "운영 흔들기", "완장 수 선동", "친목완장욕"],
  "닉언/친목/사칭": ["닉언", "닉네임 언급", "친목질", "친목", "사칭", "네임드화", "사적 친분", "외부 채널", "단톡", "인그룹"],
  "분탕/어그로": ["분탕", "어그로", "꼬투리", "고로시", "갈드컵 유도", "반복 위반", "영구 차단", "유동", "깡계"],
  "종교/음모론": ["종교", "음모론", "자연의 섭리", "짐승의 표", "베리칩", "빌 게이츠", "코로나 백신", "지구 온난화는 허구"],
  "반과학/유사과학": ["반과학", "유사과학", "반지성주의", "직업 비하", "직업 조롱", "전자레인지", "발암물질", "무조건 틀렸다"],
  "선형글/레퍼런스 부족": ["선형글", "레퍼런스 없음", "레퍼런스 없는", "AGI는 불가능", "AGI 불가능", "2045년 이후", "특이점주의에 반하는"],
  "인증/팬보이/갈드컵": ["현직자", "전공자", "구체적 인증", "인증 없이", "팬보이", "갈드컵", "모델 비교", "기업 비교", "비하 의도"],
  "도배기/역류기": ["도배기", "역류기", "도배", "공격", "방어", "댓글방어", "게시물방어"],
  "이미지 리스크": ["혐짤", "야짤", "이미지글 삭제", "gif 테러", "혐오 이미지", "짤테러", "이미지 리스크"],
  "수익/홍보/강의팔이": ["홍보", "수익", "강의", "강의팔이", "리딩방", "유료", "구독"],
  "프로그램 홍보": ["프로그램 홍보", "단순 홍보", "영리 목적", "정보 가치", "동일 프로그램", "최대 2회", "유용한 경우"],
  "주식/코인/투자": ["주식", "주.식", "코인", "코.인", "투자", "매수", "매도", "월가", "버블", "거품", "IPO", "수익률"],
  "국뽕/출산율/혐오떡밥": ["국뽕", "일뽕", "중뽕", "출산율", "혐한", "국까", "떡밥"],
  "타커뮤 캡처/조롱": ["타커뮤", "캡처", "조롱", "펨코", "루리웹", "클리앙", "아카라이브"],
  "타갤/타커뮤 언급": ["타 갤러리", "타갤", "타 커뮤니티", "타커뮤", "갤러리 언급", "커뮤니티 언급", "좌표", "침공"],
  "요주의 계정/IP/VPN": ["vpn", "ip", "깡계", "유동", "반고닉", "고닉", "차단", "저격성 콘사용", "저격성 콘", "저격콘", "반복 콘사용", "고의성 콘", "모르고 사용", "6시간", "7일", "31일"],
  "비관론갤 활동": ["비관론갤", "비관갤", "유사 갤", "활동식별코드", "비관론 주제"],
  "허위사실/이미지 저해": ["허위사실", "가짜 레퍼런스", "이미지 저해", "특정 인물", "특정 집단", "명예훼손", "낚시글"],
  "욕설싸움/분쟁": ["맥락 없는 시비", "시비성 욕설", "상호 욕설", "싸움", "개인 간 분쟁", "분쟁"],
  "금지 떡밥": ["금지 떡밥", "신세한탄", "우울글", "망상글", "완몰가", "체감글", "저격글", "디시콘", "낚시글", "기본소득", "토크나이저", "숫자 비교", "정체불명", "X 찌라시"],
  "개념글 제한": ["개념글 제한", "념글 제한", "신분이 확인되지 않은", "SNS발", "유머 게시글", "분탕 목적", "일침성 게시글", "조작이 의심되는 개념글"],
  "레퍼런스 기준": ["레퍼런스 기준", "OECD", "정부 기관", "대학 교수", "빅테크", "C레벨", "공신력", "논문", "석사", "박사", "제도권 언론", "사설", "기고문"],
  "허용 예외": ["사실에 기반한 완장 비판", "현재 기술", "AI 비판", "기술 비판", "단순 욕설", "삭제 차단 사유가 되지 않습니다"],
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
    rule_id: "seed-targeted-con-use-escalation",
    source_post_no: "manual-2026-06-03",
    title: "저격성 콘사용 제재 기준",
    body: "특정 유저를 겨냥한 조롱·공격 목적의 콘, 이모티콘, 스티커 사용이 같은 유저에게 반복되면 7~31일 차단 후보로 본다. 모르고 사용한 것처럼 보이거나 단발성·경미한 경우에는 1일 또는 6시간 차단 후보로 낮춘다. 단순 콘·스티커·이모티콘 사용만으로는 차단 후보를 만들지 않는다.",
    comments: ["검색 키워드: 저격성 콘사용 저격콘 반복 콘사용 특정 유저 겨냥 조롱 고의성 7일 31일 1일 6시간 모르고 사용"],
    image_urls: [],
    links: [],
    excerpt: "저격성 콘사용 반복 유저는 7~31일, 모르고 사용한 것처럼 보이면 1일 또는 6시간 차단 후보.",
    tags: ["요주의 계정/IP/VPN", "제재수위", "저격성 콘사용"]
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
    body: "완장고로시가 반복·파생글·여론몰이로 확인되면 경고성 1일, 7일, 31일 등 단계 처리를 검토한다. 차단 사유는 운영 방해 경고처럼 항고 대응 가능한 문구로 남긴다.",
    comments: ["검색 키워드: 1일 차단 7일 차단 31일 운영 방해 경고 반복 여론몰이"],
    image_urls: [],
    links: [],
    excerpt: "반복·파생글·여론몰이 확인 시 경고성 단기 차단 후 반복 시 강화.",
    tags: ["완장고로시", "제재수위"]
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
  },
  {
    rule_id: "seed-2026-06-13-public-scope",
    source_post_no: "public-2026-06-13",
    title: "2026-06-13 특이점이 온다 갤러리 목적과 기본 방침",
    body: "특이점이 온다 마이너 갤러리는 기술적 특이점과 관련 과학기술 정보, 소식을 공유하는 갤러리다. 초전도체/LK-99와 무관하며 특정 입장을 지지하지 않는다. 건전한 토론과 논쟁이 목적이고, 반복 위반 또는 분탕 목적 IP/계정은 내용과 무관하게 영구 차단될 수 있으며 유동/깡계정에는 강화 기준이 적용될 수 있다.",
    comments: ["검색 키워드: 기술적 특이점 과학기술 정보 초전도체 LK-99 건전한 토론 반복 위반 분탕 목적 유동 깡계 강화 기준"],
    image_urls: [],
    links: [],
    excerpt: "2026-06-13 공지: 갤러리 목적, LK-99 무관, 건전 토론, 반복 위반/분탕과 유동/깡계 강화 기준.",
    tags: ["이왜특/갤무관", "분탕/어그로"]
  },
  {
    rule_id: "seed-2026-06-13-law-social-norms",
    source_post_no: "public-2026-06-13",
    title: "디시 이용약관, 법률, 건전한 사회 통념 위반",
    body: "디시인사이드 이용 약관, 법률, 건전한 사회 통념을 위반하는 내용은 차단 및 삭제 기준이다.",
    comments: ["검색 키워드: 이용 약관 법률 불법 건전한 사회 통념 개인정보 신상 초상권 저작권"],
    image_urls: [],
    links: [],
    excerpt: "이용 약관, 법률, 건전한 사회 통념 위반은 차단/삭제 기준.",
    tags: ["이용약관/법률/사회통념"]
  },
  {
    rule_id: "seed-2026-06-13-nickname-clique-impersonation",
    source_post_no: "public-2026-06-13",
    title: "닉언, 친목질, 사칭 금지",
    body: "닉언, 친목질, 사칭은 차단 기준이다. 댓글 친목/네임드화 판단에서는 단순 언급과 실제 사적 친분, 외부 채널, 반복 사담, 인그룹 언어를 구분해야 한다.",
    comments: ["검색 키워드: 닉언 닉네임 언급 친목질 친목 사칭 네임드화 사적 친분 외부 채널 단톡 인그룹"],
    image_urls: [],
    links: [],
    excerpt: "닉언, 친목질, 사칭은 차단 기준. 단순 언급과 실제 친목/네임드화 정황을 구분.",
    tags: ["닉언/친목/사칭"]
  },
  {
    rule_id: "seed-2026-06-13-trolling-bait",
    source_post_no: "public-2026-06-13",
    title: "분탕 및 어그로",
    body: "분탕 및 어그로는 차단 기준이다. 꼬투리 잡기 등 고로시를 포함하며, 반복 위반 또는 오로지 분탕 목적 계정은 작성 내용과 무관하게 영구 차단될 수 있다.",
    comments: ["검색 키워드: 분탕 어그로 꼬투리 고로시 반복 위반 영구 차단"],
    image_urls: [],
    links: [],
    excerpt: "분탕, 어그로, 꼬투리 잡기식 고로시는 차단 기준이며 반복/목적성은 강화된다.",
    tags: ["분탕/어그로"]
  },
  {
    rule_id: "seed-2026-06-13-religion-conspiracy",
    source_post_no: "public-2026-06-13",
    title: "종교 및 음모론 금지",
    body: "모든 종류의 종교, 음모론 관련 글은 금지한다. 명확한 레퍼런스 없이 특정 사건/현상을 특정 인물/단체가 의도적으로 야기했다고 주장하거나 의혹을 제기하는 글도 음모론으로 본다. 예: BCI는 짐승의 표다, 생물학적 영생은 신의 뜻에 반한다, 빌 게이츠가 코로나 백신에 베리칩을 삽입했다, 지구 온난화는 허구다.",
    comments: ["검색 키워드: 종교 음모론 자연의 섭리 짐승의 표 베리칩 빌 게이츠 코로나 백신 지구 온난화 허구"],
    image_urls: [],
    links: [],
    excerpt: "종교/음모론 금지. 명확한 레퍼런스 없는 의도적 배후 주장이나 의혹 제기는 음모론.",
    tags: ["종교/음모론"]
  },
  {
    rule_id: "seed-2026-06-13-anti-science",
    source_post_no: "public-2026-06-13",
    title: "반과학, 유사과학, 반지성주의, 직업 비하",
    body: "반과학, 유사과학, 반지성주의, 직업 비하/조롱은 차단 기준이다. 예: 전자레인지는 발암물질을 생성한다, 특정 직업/국가/전공 종사자는 무조건 틀렸다, 특이점이 곧 오는데 특정 직업은 소멸할 일만 남았다.",
    comments: ["검색 키워드: 반과학 유사과학 반지성주의 직업 비하 직업 조롱 전자레인지 발암물질 무조건 틀렸다"],
    image_urls: [],
    links: [],
    excerpt: "반과학, 유사과학, 반지성주의, 직업 비하/조롱 금지.",
    tags: ["반과학/유사과학"]
  },
  {
    rule_id: "seed-2026-06-13-unreferenced-linear-claim",
    source_post_no: "public-2026-06-13",
    title: "레퍼런스 없는 선형글",
    body: "1개 이상의 레퍼런스를 첨부하지 않은 선형글은 차단 기준이다. 선형글은 특이점주의에 반하는 주장이다. 예: 기술적 특이점은 2045년 이후에 발생한다, AGI는 불가능하다. 디스토피아론, 전유물론 등 특이점주의와 반대되는 주장은 레퍼런스 첨부 시 허용한다.",
    comments: ["검색 키워드: 선형글 레퍼런스 없음 AGI는 불가능 기술적 특이점 2045년 이후 특이점주의 디스토피아론 전유물론"],
    image_urls: [],
    links: [],
    excerpt: "특이점주의에 반하는 선형글은 1개 이상 레퍼런스가 필요. 레퍼런스 없으면 차단 기준.",
    tags: ["선형글/레퍼런스 부족", "레퍼런스 기준"]
  },
  {
    rule_id: "seed-2026-06-13-reference-standard",
    source_post_no: "public-2026-06-13",
    title: "레퍼런스의 기준",
    body: "레퍼런스는 공식적 자리에서 한 OECD/정부 기관 종사자, 대학 전·현직 교수, 빅테크 기업 종사자, 기업 C레벨급 인물의 발언 또는 원문, 국제적으로 공신력 있는 논문, 박사/석사급 인물이 저술한 학술적 내용, 제도권 언론사의 언론 기사 순으로 우선한다. 본인의 생각을 그럴듯하게 작성한 것은 레퍼런스가 아니며 사설 및 기고문은 제외한다.",
    comments: ["검색 키워드: 레퍼런스 기준 OECD 정부 기관 대학 교수 빅테크 C레벨 논문 석사 박사 제도권 언론 사설 기고문"],
    image_urls: [],
    links: [],
    excerpt: "레퍼런스는 공식 발언/원문, 논문, 석박사 학술 내용, 제도권 기사 기준. 사설/기고문/개인 생각 제외.",
    tags: ["레퍼런스 기준"]
  },
  {
    rule_id: "seed-2026-06-13-credential-fanboy-flamebait",
    source_post_no: "public-2026-06-13",
    title: "현직자/전공자 인증, 팬보이, 갈드컵",
    body: "구체적 인증 없이 현직자/전공자를 주장하며 작성한 글, 과도한 특정 인물 팬보이 글, 의도적 갈드컵 유발 글은 차단 기준이다. 갈드컵은 악의성/비하성을 중점으로 구분한다. 공격 또는 비하 의도가 없는 단순 모델 비교나 기업 비교는 갈드컵이 아니지만, 유사 내용을 반복 작성하면 갈드컵 유도로 제재될 수 있다.",
    comments: ["검색 키워드: 현직자 전공자 구체적 인증 팬보이 갈드컵 모델 비교 기업 비교 악의성 비하성 반복 작성"],
    image_urls: [],
    links: [],
    excerpt: "인증 없는 현직자/전공자 주장, 과도한 팬보이, 악의적/반복적 갈드컵 유도 금지.",
    tags: ["인증/팬보이/갈드컵"]
  },
  {
    rule_id: "seed-2026-06-13-stocks-coins-investment",
    source_post_no: "public-2026-06-13",
    title: "주식, 코인, 투자 관련 글 금지",
    body: "주식, 코인, 투자 관련 글은 차단 기준이다.",
    comments: ["검색 키워드: 주식 주.식 코인 코.인 투자 매수 매도 수익률 월가 버블 거품 IPO"],
    image_urls: [],
    links: [],
    excerpt: "주식, 코인, 투자 관련 글은 차단 기준.",
    tags: ["주식/코인/투자"]
  },
  {
    rule_id: "seed-2026-06-13-nationalism-birthrate-hatebait",
    source_post_no: "public-2026-06-13",
    title: "국뽕/출산율/혐한/국까 떡밥 금지",
    body: "과도한 국뽕, 일뽕, 중뽕, 출산율, 혐한/국까 떡밥은 차단 기준이다.",
    comments: ["검색 키워드: 국뽕 일뽕 중뽕 출산율 혐한 국까 떡밥"],
    image_urls: [],
    links: [],
    excerpt: "과도한 국뽕, 일뽕, 중뽕, 출산율, 혐한/국까 떡밥 금지.",
    tags: ["국뽕/출산율/혐오떡밥"]
  },
  {
    rule_id: "seed-2026-06-13-politics-region-gender",
    source_post_no: "public-2026-06-13",
    title: "정치, 지역드립, 성별 혐오",
    body: "모든 종류의 국내외 정치, 지역드립, 성별 혐오는 금지한다. 단, 시행/도입 등이 이미 확정된 국가 차원의 정책에 대한 의견이 섞이지 않은 사실 전달은 허용될 수 있다. 특이점과 관련이 없거나 사실 전달 목적을 벗어나거나 지지/조롱 목적이 조금이라도 담긴 내용은 글/댓글을 불문하고 금지다.",
    comments: ["검색 키워드: 국내외 정치 지역드립 성별 혐오 정책 사실 전달 지지 조롱 반복 작성 사설 기고문"],
    image_urls: [],
    links: [],
    excerpt: "국내외 정치/지역드립/성별 혐오 금지. 확정 정책의 의견 없는 사실 전달만 예외 가능.",
    tags: ["정치/지역/성별혐오", "정떡"]
  },
  {
    rule_id: "seed-2026-06-13-other-gallery-community",
    source_post_no: "public-2026-06-13",
    title: "타 갤러리, 타 커뮤니티 언급",
    body: "타 갤러리, 타 커뮤니티 언급은 차단 기준이다. 타 커뮤니티 캡처, 조롱, 좌표, 침공 유도와 결합하면 더 강한 운영 리스크로 본다.",
    comments: ["검색 키워드: 타 갤러리 타갤 타 커뮤니티 타커뮤 언급 캡처 조롱 좌표 침공"],
    image_urls: [],
    links: [],
    excerpt: "타 갤러리와 타 커뮤니티 언급은 차단 기준. 캡처/조롱/좌표와 결합하면 고위험.",
    tags: ["타갤/타커뮤 언급", "타커뮤 캡처/조롱"]
  },
  {
    rule_id: "seed-2026-06-13-pessimism-gallery-activity",
    source_post_no: "public-2026-06-13",
    title: "비관론갤 및 유사 갤 활동자",
    body: "비관론갤 및 유사 갤에서 활동한 자는 차단 기준에 포함된다. 현재 페이지 증거와 로컬 요주의 계정 맥락을 구분하고, 외부 활동 정보만으로 자동 조치하지 않는다.",
    comments: ["검색 키워드: 비관론갤 비관갤 유사 갤 활동자 활동식별코드 요주의 계정"],
    image_urls: [],
    links: [],
    excerpt: "비관론갤 및 유사 갤 활동자는 차단 기준. 현재 증거와 계정 맥락을 구분.",
    tags: ["비관론갤 활동", "요주의 계정/IP/VPN"]
  },
  {
    rule_id: "seed-2026-06-13-false-information-reputation",
    source_post_no: "public-2026-06-13",
    title: "허위사실 유포와 이미지 저해",
    body: "허위사실 유포로 인해 특정 인물이나 집단의 이미지를 저해할 경우 차단 기준이다. 낚시글, 가짜 레퍼런스, 조작 의심 글은 별도 삭제 기준과 함께 본다.",
    comments: ["검색 키워드: 허위사실 유포 특정 인물 특정 집단 이미지 저해 가짜 레퍼런스 낚시글 조작 의심"],
    image_urls: [],
    links: [],
    excerpt: "허위사실로 특정 인물/집단의 이미지를 저해하면 차단 기준.",
    tags: ["허위사실/이미지 저해"]
  },
  {
    rule_id: "seed-2026-06-13-abusive-fight",
    source_post_no: "public-2026-06-13",
    title: "맥락 없는 시비성 욕설과 상호 욕설 싸움",
    body: "맥락 없는 시비성 욕설, 상호 간 욕설이 포함된 싸움은 삭제 기준이다. 단순 욕설 자체는 삭제/차단 사유가 되지 않는 예외와 구분한다.",
    comments: ["검색 키워드: 맥락 없는 시비성 욕설 상호 욕설 싸움 개인 간 분쟁 단순 욕설 예외"],
    image_urls: [],
    links: [],
    excerpt: "맥락 없는 시비성 욕설과 상호 욕설 싸움은 삭제 기준. 단순 욕설 예외와 구분.",
    tags: ["욕설싸움/분쟁", "허용 예외"]
  },
  {
    rule_id: "seed-2026-06-13-banned-topics",
    source_post_no: "public-2026-06-13",
    title: "금지 떡밥 게시글 삭제 기준",
    body: "금지 떡밥 게시글은 삭제 기준이다. 예: 신세한탄, 우울글, 망상글, 체감글, 저격글(디시콘 포함), 낚시글, 허위사실 유포, 기본소득, 갤러리 주제와 무관한 글, 나눔 없는 자랑 글, 개인 간 분쟁, 조작이 의심되는 개념글, 숫자 비교 등 토크나이저 문제 관련 글, 정체불명 인물의 X 찌라시로 인한 갤러리 과열.",
    comments: ["검색 키워드: 신세한탄 우울글 망상글 완몰가 체감글 저격글 디시콘 낚시글 기본소득 나눔 없는 자랑 개인 간 분쟁 토크나이저 숫자 비교 정체불명 X 찌라시"],
    image_urls: [],
    links: [],
    excerpt: "신세한탄/우울/망상/체감/저격/낚시/기본소득/토크나이저/X 찌라시 등 금지 떡밥은 삭제 기준.",
    tags: ["금지 떡밥", "허위사실/이미지 저해", "욕설싸움/분쟁"]
  },
  {
    rule_id: "seed-2026-06-13-front-page-limit",
    source_post_no: "public-2026-06-13",
    title: "개념글 제한 기준",
    body: "개념글 제한 대상 예시: 신분이 확인되지 않은 인물의 AGI 및 특이점 시기 떡밥, 신분이 확인되지 않은 인물의 SNS발 내용, 갈드컵/혐오 요소 등 공지 금지 내용이 포함된 유머 게시글, 분탕 목적 또는 일침성 게시글.",
    comments: ["검색 키워드: 개념글 제한 신분이 확인되지 않은 AGI 특이점 시기 SNS발 유머 게시글 갈드컵 혐오 분탕 목적 일침성"],
    image_urls: [],
    links: [],
    excerpt: "신분 미확인 인물의 AGI/시기/SNS발 내용, 금지요소 유머, 분탕/일침성 글은 개념글 제한 기준.",
    tags: ["개념글 제한", "인증/팬보이/갈드컵", "금지 떡밥"]
  },
  {
    rule_id: "seed-2026-06-13-allowed-exceptions",
    source_post_no: "public-2026-06-13",
    title: "삭제, 차단의 사유가 되지 않는 예외",
    body: "다음은 삭제, 차단의 사유가 되지 않는다: 사실에 기반한 완장 비판, 현재 기술(AI 등)에 대한 비판, 단순 욕설. 다만 별도 금지 조항과 결합된 경우에는 해당 금지 조항을 검토한다.",
    comments: ["검색 키워드: 사실에 기반한 완장 비판 현재 기술 AI 비판 단순 욕설 삭제 차단 사유가 되지 않습니다"],
    image_urls: [],
    links: [],
    excerpt: "사실 기반 완장 비판, 현재 기술 비판, 단순 욕설은 그 자체로 삭제/차단 사유가 아니다.",
    tags: ["허용 예외", "완장고로시"]
  },
  {
    rule_id: "seed-2026-06-13-program-promotion",
    source_post_no: "public-2026-06-13",
    title: "프로그램 홍보 관련 기준",
    body: "프로그램 홍보는 다음 기준을 충족하는 경우에만 허용된다. 단순 홍보글은 금지, 정보 가치가 충분한 경우 영리 목적이라도 허용, 이용자 반응이 좋거나 실질적으로 유용한 경우 허용, 동일 프로그램 홍보는 최대 2회까지 허용.",
    comments: ["검색 키워드: 프로그램 홍보 단순 홍보글 금지 정보 가치 영리 목적 이용자 반응 유용 동일 프로그램 최대 2회"],
    image_urls: [],
    links: [],
    excerpt: "단순 홍보 금지. 정보 가치/유용성 있으면 영리도 허용 가능. 동일 프로그램 홍보는 최대 2회.",
    tags: ["프로그램 홍보", "수익/홍보/강의팔이"]
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

  return corpus;
}
