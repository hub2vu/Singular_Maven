import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { createJudgePrompt } from "../../src/backend/judge/schema.js";
import type { PolicyEvidence } from "../../src/shared/types.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("content script extracts DCInside post DOM into an LLM-ready observation", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(repoRoot, "tests/fixtures/dcinside-post.html")).toString());
  await page.addScriptTag({ path: path.join(repoRoot, "extension/content.js") });

  const observation = await page.evaluate(() => window.__dcMavenCollectObservationForTest());
  expect(observation.url).toContain("dcinside-post.html");
  expect(observation.title).toContain("이왜특 정치 떡밥인가");
  expect(observation.head).toBe("일반");
  expect(observation.author.name).toBe("테스터");
  expect(observation.bodyText).toContain("본문 핵심");
  expect(observation.comments).toHaveLength(3);
  expect(observation.comments[0]?.authorIdentity?.ip).toBe("223.39");
  expect(observation.comments[1]?.authorIdentity?.uid).toBe("replyuser");
  expect(observation.comments[1]?.authorIdentity?.ip).toBe("118.235");
  expect(observation.comments[1].depth).toBe(1);
  expect(observation.comments[2]?.authorIdentity?.name).toBe("퐁칸8");
  expect(observation.comments[2]?.authorIdentity?.uid).toBe("zxvw157");
  expect(observation.comments[2]?.authorIdentity?.ip).toBe("211.36");
  expect(observation.images).toHaveLength(4);
  expect(observation.images[0].src).toContain("risk.png");
  expect(observation.images.slice(1).map((image) => image.src)).toEqual([
    "https://image.dcinside.com/download.php?no=abc123&f_no=ChatGPT%20Image%202026%EB%85%84%206%EC%9B%94%202%EC%9D%BC%20%EC%98%A4%ED%9B%84%2012_59_35.png",
    "https://image.dcinside.com/download.php?no=def456&f_no=image.png",
    "https://image.dcinside.com/download.php?no=ghi789&f_no=image.png"
  ]);
  expect(observation.images[1].alt).toContain("ChatGPT Image");
  expect(observation.images[1].nearbyText).toContain("원본 첨부파일");
  expect(JSON.stringify(observation.images)).not.toContain("ads.example");
  expect(observation.links[0].text).toBe("홍보 링크");
  expect(observation.clickableLabels).toContain("댓글 보기");
  expect(observation.metadata.commentEmoticonDetections).toEqual([expect.objectContaining({
    names: ["저격콘", "comment-con"],
    primaryName: "저격콘",
    iconTitle: "저격콘",
    sourceHint: "comment-con",
    nearbyText: expect.stringContaining("comment[2]")
  })]);
  expect(observation.metadata.commentEmoticonDetections[0].nearbyText).toContain("@테스터 닉언콘");

  const evidence: PolicyEvidence[] = [
    {
      rule_id: "post-1226405-bot-command",
      source_post_no: "1226405",
      title: "특갤봇 명령어",
      excerpt: "@특갤봇 댓글방어(n)의 n은 1~10",
      relevance: 0.91,
      tags: ["bot_command"]
    }
  ];
  const prompt = createJudgePrompt({ observation, evidence, model: "test", visionEnabled: false });
  expect(prompt.user).toContain("본문 핵심");
  expect(prompt.user).toContain("@특갤봇 댓글방어(3)");
  expect(prompt.user).toContain("https://dcimg.example/risk.png");
  expect(prompt.user).toContain("https://image.dcinside.com/download.php?no=abc123");
  expect(prompt.user).toContain("1226405");
});

test("content script resolves comment DCCon package names instead of numeric icon titles", async ({ page }) => {
  const dcconCode = "62b5df2be09d3ca567b1c5bc12d46b394aa3b1058c6e4d0ca41648b65ced216e0de3554b73b3e310bd12e402de2dd5016f99379428980d2e94eb63caadd8b9164da620042dc1b4f76fd98fdc78b1d9f44c00dfca6066";
  const packageDetailRequests: string[] = [];
  await page.route("https://gall.dcinside.com/mgallery/board/view/**", async (route) => {
    await route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html>
        <html lang="ko">
          <head><meta charset="utf-8" /><title>디시콘 이름 테스트</title></head>
          <body>
            <main class="view_content_wrap">
              <section class="gallview_head">
                <div class="title"><span class="title_subject">디시콘 이름 테스트</span></div>
                <div class="gall_writer ub-writer" data-uid="writer1"><span class="nickname">작성자</span></div>
              </section>
              <article class="write_div"><p>본문</p></article>
              <section class="comment_box">
                <ul class="cmt_list">
                  <li id="comment_li_dccon" class="ub-content" data-ip="223.39">
                    <span class="name">댓글러</span>
                    <span class="date_time">06.03 20:04:43</span>
                    <div class="usertxt ub-word">
                      <div class="comment_dccon clear">
                        <div class="coment_dccon_img">
                          <video class="written_dccon" data-src="https://dcimg5.dcinside.com/dccon.php?no=${dcconCode}" conalt="32" alt="32" title="32">
                            <source src="https://dcimg5.dcinside.com/dccon.php?no=${dcconCode}bab7d2f3" type="video/mp4" />
                          </video>
                        </div>
                        <div class="coment_dccon_info clear dccon_over_box">
                          <span class="over_alt"></span>
                          <button type="button" class="btn_dccon_infoview div_package" data-type="comment" reqpath="/dccon">디시콘 보기</button>
                        </div>
                      </div>
                    </div>
                  </li>
                </ul>
              </section>
            </main>
          </body>
        </html>`
    });
  });
  await page.route("https://gall.dcinside.com/dccon/package_detail", async (route) => {
    packageDetailRequests.push(route.request().postData() || "");
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        info: {
          package_idx: "171257",
          title: "구구가가콘 3",
          code: dcconCode,
          price: "0"
        },
        detail: [{ idx: "6118884", title: "32", path: dcconCode }]
      })
    });
  });

  await page.goto("https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1229777&page=1");
  await page.addScriptTag({ path: path.join(repoRoot, "extension/content.js") });

  const observation = await page.evaluate(async () => window.__dcMavenCollectObservationForTestAsync());
  const [detection] = observation.metadata.commentEmoticonDetections;

  expect(packageDetailRequests).toHaveLength(1);
  expect(packageDetailRequests[0]).toContain(`code=${encodeURIComponent(dcconCode)}`);
  expect(detection.primaryName).toBe("구구가가콘 3");
  expect(detection.packageName).toBe("구구가가콘 3");
  expect(detection.packageIdx).toBe("171257");
  expect(detection.iconTitle).toBe("32");
  expect(detection.names).toContain("구구가가콘 3");
  expect(detection.names).not.toContain("32");
  expect(detection.nearbyText).toContain("구구가가콘 3");
});

test("content script can resolve a comment UID from the DCInside user memo popup", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(repoRoot, "tests/fixtures/dcinside-post.html")).toString());
  await page.addScriptTag({ path: path.join(repoRoot, "extension/content.js") });

  const before = await page.evaluate(() => window.__dcMavenCollectObservationForTest());
  expect(before.comments[0]?.authorIdentity?.uid).toBeUndefined();

  const after = await page.evaluate(async () => {
    const observation = window.__dcMavenCollectObservationForTest();
    return window.__dcMavenResolveCommentUidsForTest(observation);
  });

  expect(after.comments[0]?.authorIdentity?.uid).toBe("indoor4684");
  expect(after.comments[0]?.authorIdentity?.raw).toContain("uid:indoor4684");
});

test("content script prefers the DCInside write_div over earlier page articles when extracting images", async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <html lang="ko">
      <head>
        <title>Direct body image fixture</title>
      </head>
      <body>
        <article id="unrelated-preview">Earlier page chrome article</article>
        <section class="gallview_head">
          <div class="title">
            <span class="title_subject">Direct body image post</span>
          </div>
        </section>
        <div class="gallview_contents">
          <div class="writing_view_box">
            <div class="write_div">
              <p>Direct body image body text</p>
              <p>
                <img id="auto_zzal_img" src="https://dcimg8.dcinside.co.kr/viewimage.php?no=bodyimage123" alt="body upload" />
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: path.join(repoRoot, "extension/content.js") });

  const observation = await page.evaluate(() => window.__dcMavenCollectObservationForTest());

  expect(observation.bodyText).toContain("Direct body image");
  expect(observation.images).toHaveLength(1);
  expect(observation.images[0]).toMatchObject({
    src: "https://dcimg8.dcinside.co.kr/viewimage.php?no=bodyimage123",
    alt: "body upload"
  });
});

test("content script extracts visible list posts with attached-image markers", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(repoRoot, "tests/fixtures/dcinside-list.html")).toString());
  await page.addScriptTag({ path: path.join(repoRoot, "extension/content.js") });

  const result = await page.evaluate(() => window.__dcMavenCollectVisibleListPostsForTest());

  expect(result.ok).toBe(true);
  expect(result.posts).toHaveLength(3);
  expect(result.posts[0]).toMatchObject({
    title: "Photo briefing target",
    hasImage: true,
    postNo: "1227001",
    head: "general"
  });
  expect(result.posts[0].url).toBe("https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1227001&page=1");
  expect(result.posts[1]).toMatchObject({
    title: "Comment only target",
    hasImage: false,
    postNo: "1227002"
  });
  expect(result.posts[2]).toMatchObject({
    title: "HTML direct target",
    hasImage: true,
    postNo: "1227003",
    visible: false,
    source: "html-link"
  });
});
