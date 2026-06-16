import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverPolicyPath } from "../../src/backend/policy/pathDiscovery.js";
import { ingestPolicyCorpus } from "../../src/backend/policy/ingest.js";
import { retrievePolicyEvidence } from "../../src/backend/policy/retrieval.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const jsonPath = path.join(repoRoot, "dcinside_manager_posts_thesingularity_2026-06-02.json");
const mdPath = path.join(repoRoot, "dcinside_manager_report_thesingularity_2026-06-02.md");

function observationFor(title: string, bodyText: string) {
  return {
    url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=999999",
    title,
    galleryId: "thesingularity",
    postNo: "999999",
    bodyText,
    comments: [],
    images: [],
    links: [],
    metadata: {},
    selectedText: "",
    viewportText: bodyText,
    clickableLabels: []
  };
}

describe("policy corpus", () => {
  it("discovers the structured JSON corpus even when the report markdown is provided", async () => {
    const discovered = await discoverPolicyPath({ cwd: repoRoot, requestedPath: mdPath });

    expect(discovered.kind).toBe("json");
    expect(discovered.path).toBe(jsonPath);
    expect(discovered.path).not.toContain("ID_");
  });

  it("does not accept a generated policy index as the policy path", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "maven-policy-discovery-"));
    try {
      const sourcePath = path.join(tmp, "dcinside_manager_posts_test_2026-06-06.json");
      const dataDir = path.join(tmp, "data");
      const indexPath = path.join(dataDir, "policy-index.json");
      await mkdir(dataDir, { recursive: true });
      await writeFile(sourcePath, "{}", "utf8");
      await writeFile(indexPath, "{}", "utf8");

      const discovered = await discoverPolicyPath({ cwd: tmp, requestedPath: indexPath });

      expect(discovered.path).toBe(sourcePath);
      expect(discovered.path).not.toContain("policy-index.json");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("ingests posts, comments, image URLs, links, and source post numbers without writing a policy index", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "maven-policy-"));
    try {
      const corpus = await ingestPolicyCorpus({ sourcePath: jsonPath, outDir: tmp });
      const commandPost = corpus.documents.find((doc) => doc.source_post_no === "1226405");
      const indexPath = path.join(tmp, "policy-index.json");

      expect(corpus.count).toBeGreaterThan(250);
      expect(commandPost?.title).toContain("특갤봇");
      expect(commandPost?.comments.join("\n")).toContain("@특갤에이전트");
      expect(commandPost?.image_urls.length).toBeGreaterThan(0);
      expect(commandPost?.links.some((link) => link.href.includes("1193580"))).toBe(true);
      expect(corpus.schema_version).toBe(2);
      expect(corpus.rules?.length).toBe(corpus.documents.length);
      expect(corpus.rules?.every((rule) => rule.source_post_no && rule.guidance && rule.quote && !rule.search_text.includes("undefined"))).toBe(true);
      expect(corpus.rules?.some((rule) => rule.source_post_no === "1226405" && rule.kind === "bot_command")).toBe(true);
      expect(corpus.rules?.some((rule) => rule.rule_id === "seed-mod-repeated-evidence-case#compact" && rule.category === "완장고로시")).toBe(true);
      expect(corpus.rules?.some((rule) => (
        rule.rule_id === "seed-targeted-con-use-escalation#compact" &&
        rule.guidance.includes("7~31일") &&
        rule.guidance.includes("1일 또는 6시간")
      ))).toBe(true);
      expect(corpus.rules?.some((rule) => rule.rule_id === "seed-2026-06-13-reference-standard#compact" && rule.category === "레퍼런스 기준")).toBe(true);
      expect(corpus.rules?.some((rule) => rule.rule_id === "seed-2026-06-13-nickname-clique-impersonation#compact" && rule.category === "닉언/친목/사칭")).toBe(true);
      expect(corpus.rules?.some((rule) => rule.rule_id === "seed-2026-06-13-allowed-exceptions#compact" && rule.category === "허용 예외")).toBe(true);
      expect(corpus.rules?.flatMap((rule) => rule.tags)).not.toContain("오탐방지");
      expect(corpus.documents.some((doc) => doc.rule_id.includes("nickcon"))).toBe(false);
      await expect(access(indexPath)).rejects.toThrow();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("retrieves 2026-06-13 public policy evidence for newly covered rule categories", async () => {
    const corpus = await ingestPolicyCorpus({ sourcePath: jsonPath });
    const cases = [
      ["종교와 음모론", "BCI는 짐승의 표다. 빌 게이츠가 백신에 베리칩을 삽입했다는 음모론과 종교 떡밥입니다.", "종교/음모론"],
      ["반과학과 직업 비하", "전자레인지는 발암물질을 생성한다. 특정 직업 종사자는 무조건 틀렸다는 반과학 유사과학 직업 비하 글입니다.", "반과학/유사과학"],
      ["레퍼런스 없는 선형글", "AGI는 불가능하다. 기술적 특이점은 2045년 이후에나 온다. 레퍼런스 없는 선형글입니다.", "선형글/레퍼런스 부족"],
      ["닉언 친목 사칭", "특정 닉네임을 부르며 사적 친분을 과시하고 다른 이용자를 사칭하는 닉언 친목질 글입니다.", "닉언/친목/사칭"],
      ["주식 코인 투자", "AI 회사 주식 매수 매도와 코인 투자 수익률을 이야기하는 주식 코인 투자 글입니다.", "주식/코인/투자"],
      ["국뽕 출산율 혐오", "국뽕 일뽕 중뽕 출산율 혐한 국까 떡밥을 섞어 과열시키는 글입니다.", "국뽕/출산율/혐오떡밥"],
      ["정치 지역 성별 혐오", "국내외 정치 지지 조롱, 지역드립, 성별 혐오가 섞인 글입니다.", "정치/지역/성별혐오"],
      ["타 갤러리 언급", "타 갤러리와 타 커뮤니티를 언급하며 좌표와 조롱을 유도하는 글입니다.", "타갤/타커뮤 언급"],
      ["허위사실 유포", "근거 없는 허위사실을 유포해 특정 인물이나 집단의 이미지를 저해하는 글입니다.", "허위사실/이미지 저해"],
      ["금지 떡밥", "신세한탄 우울글 망상글 체감글 기본소득 토크나이저 숫자 비교 정체불명 X 찌라시입니다.", "금지 떡밥"],
      ["허용 예외", "사실에 기반한 완장 비판, 현재 AI 기술에 대한 비판, 단순 욕설입니다.", "허용 예외"]
    ] as const;

    for (const [title, bodyText, category] of cases) {
      const evidence = retrievePolicyEvidence(corpus, observationFor(title, bodyText), 10);
      expect(evidence.some((item) => item.category === category && item.rule_id.startsWith("seed-2026-06-13-"))).toBe(true);
    }
  });

  it("retrieves evidence by issue language without making the final moderation decision", async () => {
    const corpus = await ingestPolicyCorpus({ sourcePath: jsonPath });
    const evidence = retrievePolicyEvidence(corpus, {
      url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=999999",
      title: "닉언콘으로 친목하고 @특갤봇 댓글방어(3) 호출해야 하나요",
      galleryId: "thesingularity",
      postNo: "999999",
      bodyText: "2026-06-02 이후 닉언콘과 도배기 공격이 섞여 있습니다.",
      comments: [{ id: "c1", author: "ㅇㅇ", text: "@특갤봇 댓글방어(3)", depth: 0 }],
      images: [],
      links: [],
      metadata: {},
      selectedText: "",
      viewportText: "닉언콘 도배기 댓글방어",
      clickableLabels: []
    }, 8);

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.some((item) => item.source_post_no === "1226405")).toBe(true);
    expect(evidence.some((item) => item.category === "특갤봇 명령 후보")).toBe(true);
    expect(evidence.every((item) => item.guidance && item.quote)).toBe(true);
    expect(evidence.every((item) => item.excerpt.length <= 220)).toBe(true);
    expect(evidence.some((item) => item.rule_id.includes("nickcon"))).toBe(false);
    expect(evidence.some((item) => item.category === "닉언/친목/사칭")).toBe(true);
    expect(evidence.every((item) => item.excerpt.length > 10)).toBe(true);
  });

  it("retrieves targeted con-use escalation criteria alongside the current nickname and clique rule", async () => {
    const corpus = await ingestPolicyCorpus({ sourcePath: jsonPath });
    const evidence = retrievePolicyEvidence(corpus, {
      url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=999998",
      title: "저격성 콘사용 반복 유저 제재 기준 확인",
      galleryId: "thesingularity",
      postNo: "999998",
      bodyText: "같은 유저가 특정 고닉 글마다 저격콘을 반복적으로 달아 조롱합니다. 모르고 사용한 것 같으면 6시간이나 1일인지 확인이 필요합니다.",
      comments: [{ id: "c1", author: "ㅇㅇ", text: "이건 단순 콘이 아니라 저격성 콘사용 같음", depth: 0 }],
      images: [],
      links: [],
      metadata: {},
      selectedText: "",
      viewportText: "저격성 콘사용 반복 7일 31일 6시간 1일",
      clickableLabels: []
    }, 8);

    const targetedConRule = evidence.find((item) => item.rule_id === "seed-targeted-con-use-escalation#compact");

    expect(targetedConRule?.source_post_no).toBe("manual-2026-06-03");
    expect(targetedConRule?.excerpt).toContain("7~31일");
    expect(targetedConRule?.excerpt).toContain("1일 또는 6시간");
    expect(evidence.some((item) => item.rule_id.includes("nickcon"))).toBe(false);
    expect(evidence.some((item) => item.category === "닉언/친목/사칭")).toBe(true);
  });

  it("does not over-tag generic manager posts as mod attacks or image risk", async () => {
    const corpus = await ingestPolicyCorpus({ sourcePath: jsonPath });
    const genericManagerDocs = corpus.documents.filter((doc) => (
      doc.source_type === "post" &&
      /매니저|부매니저|파딱|주딱/u.test(`${doc.title} ${doc.body}`) &&
      !/완장\s*고로시|파딱\s*고로시|주딱\s*고로시|운영\s*방해|운영진을\s*흔들|운영\s*흔들|완장 욕|파딱 욕|주딱 욕/u.test(`${doc.title} ${doc.body} ${doc.comments.join(" ")}`)
    ));
    const plainImageDocs = corpus.documents.filter((doc) => (
      doc.source_type === "post" &&
      doc.image_urls.length > 0 &&
      !/혐짤|야짤|이미지글 삭제|gif 테러|혐오 이미지|짤테러/u.test(`${doc.title} ${doc.body}`)
    ));

    expect(genericManagerDocs.some((doc) => doc.tags.includes("완장고로시"))).toBe(false);
    expect(plainImageDocs.some((doc) => doc.tags.includes("이미지 리스크"))).toBe(false);
  });

  it("retrieves mod-goro evidence only for attack frames, not moderator anchor words alone", async () => {
    const corpus = await ingestPolicyCorpus({ sourcePath: jsonPath });
    const safeEvidence = retrievePolicyEvidence(corpus, {
      url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=888001",
      title: "완장분들 파이팅입니다",
      galleryId: "thesingularity",
      postNo: "888001",
      head: "일반",
      bodyText: "새 부매니저 가이드와 특갤봇 명령어 확인했습니다. 수고 많으십니다.",
      comments: [{ id: "c1", author: "ㅇㅇ", text: "AI 파딱 나오면 재미있겠네요", depth: 0 }],
      images: [],
      links: [],
      metadata: {},
      clickableLabels: []
    }, 8);
    const riskyEvidence = retrievePolicyEvidence(corpus, {
      url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=888002",
      title: "완장 공포정치 또 시작이네",
      galleryId: "thesingularity",
      postNo: "888002",
      head: "일반",
      bodyText: "완장 에고랑 친목완장 때문에 갤 망한다. 운영진을 흔들어야 하고 계속 여론 만들어야 한다.",
      comments: [{ id: "c1", author: "ㅇㅇ", text: "파딱 내려가라 추천으로 밀자", depth: 0 }],
      images: [],
      links: [],
      metadata: {},
      clickableLabels: []
    }, 8);

    expect(safeEvidence.some((item) => item.category === "완장고로시")).toBe(false);
    expect(riskyEvidence.some((item) => item.category === "완장고로시")).toBe(true);
    expect(riskyEvidence.some((item) => item.source_post_no === "1201546")).toBe(true);
  });
});
