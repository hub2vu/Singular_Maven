import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("content-script safety broker blocks irreversible clicks and allows prefill only", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(repoRoot, "tests/fixtures/safety-buttons.html")).toString());
  await page.addScriptTag({ path: path.join(repoRoot, "extension/content.js") });

  const deleteAttempt = await page.evaluate(() => window.__dcMavenSafeActionForTest({ kind: "click", selector: "#deleteBtn", label: "삭제" }));
  const banAttempt = await page.evaluate(() => window.__dcMavenSafeActionForTest({ kind: "click", selector: "#banBtn", label: "차단" }));
  const commentAttempt = await page.evaluate(() => window.__dcMavenSafeActionForTest({ kind: "click", selector: "#commentSubmit", label: "댓글등록" }));
  const prefillAttempt = await page.evaluate(() => window.__dcMavenSafeActionForTest({ kind: "prefill", selector: "#reason", label: "사유 입력", value: "수동 검토 사유" }));

  expect(deleteAttempt.allowed).toBe(false);
  expect(banAttempt.allowed).toBe(false);
  expect(commentAttempt.allowed).toBe(false);
  expect(prefillAttempt.allowed).toBe(true);
  expect(await page.evaluate(() => window.clickedDelete || 0)).toBe(0);
  expect(await page.evaluate(() => window.clickedBan || 0)).toBe(0);
  expect(await page.evaluate(() => window.clickedComment || 0)).toBe(0);
  await expect(page.locator("#reason")).toHaveValue("수동 검토 사유");
});
