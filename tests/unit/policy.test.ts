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
      expect(corpus.rules?.flatMap((rule) => rule.tags)).not.toContain("오탐방지");
      expect(corpus.documents.some((doc) => doc.rule_id.includes("nickcon"))).toBe(false);
      expect(corpus.documents.flatMap((doc) => doc.tags)).not.toContain("닉언콘/친목");
      await expect(access(indexPath)).rejects.toThrow();
    } finally {
      await rm(tmp, { recursive: true, force: true });
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
    expect(evidence.flatMap((item) => item.tags)).not.toContain("닉언콘/친목");
    expect(evidence.every((item) => item.excerpt.length > 10)).toBe(true);
  });

  it("retrieves targeted con-use escalation criteria without restoring nickname-con blanket rules", async () => {
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
    expect(evidence.flatMap((item) => item.tags)).not.toContain("닉언콘/친목");
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
