import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const extensionPath = path.join(repoRoot, "extension");
const fixturePath = path.join(repoRoot, "tests", "fixtures", "dcinside-post.html");
const backendPort = 8791;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function waitForBackend(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Backend smoke server did not become ready");
}

async function main() {
  const fixtureHtml = await readFile(fixturePath, "utf8");
  const staticServer = createServer((req, res) => {
    if (req.url === "/dcinside-post.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fixtureHtml);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await listen(staticServer, 8790);

  const backend = spawn(process.execPath, ["dist/backend/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(backendPort),
      HOST: "127.0.0.1",
      MAVEN_ALLOW_MOCK_LLM: "1"
    },
    stdio: "pipe",
    windowsHide: true
  });

  const userDataDir = await mkdtemp(path.join(tmpdir(), "maven-extension-smoke-"));
  let context;
  try {
    await waitForBackend(backendPort);
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
    }
    const extensionId = new URL(worker.url()).host;

    const page = await context.newPage();
    await page.goto("http://127.0.0.1:8790/dcinside-post.html");
    await page.bringToFront();

    const observedResponse = await worker.evaluate(async () => {
      const response = await observeActiveTab();
      return {
        ok: response.ok,
        observation: response.observation,
        screenshotPresent: Boolean(response.screenshotDataUrl),
        screenshotDataUrl: response.screenshotDataUrl || undefined,
        screenshotError: response.screenshotError || null
      };
    });
    const backgroundResult = {
      ok: observedResponse.ok,
      title: observedResponse.observation?.title,
      bodyText: observedResponse.observation?.bodyText,
      comments: observedResponse.observation?.comments?.length,
      images: observedResponse.observation?.images?.length,
      screenshotPresent: observedResponse.screenshotPresent,
      screenshotError: observedResponse.screenshotError
    };

    if (!backgroundResult.ok) {
      throw new Error(`Extension observation failed: ${JSON.stringify(backgroundResult)}`);
    }
    if (!backgroundResult.title?.includes("이왜특 정치 떡밥인가")) {
      throw new Error(`Unexpected observation title: ${backgroundResult.title}`);
    }
    if (!backgroundResult.bodyText?.includes("본문 핵심")) {
      throw new Error("Observation did not include fixture body text");
    }
    if (backgroundResult.comments !== 2 || backgroundResult.images !== 1) {
      throw new Error(`Observation counts wrong: ${JSON.stringify(backgroundResult)}`);
    }

    const judgeResponse = await fetch(`http://127.0.0.1:${backendPort}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ observation: observedResponse.observation, screenshotDataUrl: observedResponse.screenshotDataUrl })
    });
    if (!judgeResponse.ok) {
      throw new Error(`Backend judge failed: ${judgeResponse.status} ${await judgeResponse.text()}`);
    }
    const judgeJson = await judgeResponse.json();
    if (judgeJson.card?.final_human_decision_required !== true) {
      throw new Error(`Judge card missing human decision requirement: ${JSON.stringify(judgeJson)}`);
    }
    if (!Array.isArray(judgeJson.card?.matched_rules) || judgeJson.card.matched_rules.length === 0) {
      throw new Error("Judge card did not include matched policy rules");
    }

    const sidePanel = await context.newPage();
    await sidePanel.addInitScript(({ port, observation, screenshotDataUrl }) => {
      localStorage.setItem("mavenBackendUrl", `http://127.0.0.1:${port}`);
      window.__DC_MAVEN_TEST__ = {
        sendMessage: async (message) => {
          if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
            return { ok: true, observation, screenshotDataUrl };
          }
          return { ok: true };
        }
      };
    }, {
      port: backendPort,
      observation: observedResponse.observation,
      screenshotDataUrl: observedResponse.screenshotDataUrl
    });
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidePanel.locator("#authStatus").waitFor({ state: "visible" });
    await sidePanel.getByRole("button", { name: /이 페이지 LLM 판단/ }).click();
    await sidePanel.getByText("final_human_decision_required: true").waitFor({ timeout: 15_000 });
    const sidePanelError = await sidePanel.locator("#errorPanel").textContent();
    if (sidePanelError?.trim()) {
      throw new Error(`Side panel showed an error: ${sidePanelError}`);
    }

    console.log(JSON.stringify({
      ok: true,
      extensionObservation: backgroundResult,
      sidePanelJudgeRendered: true,
      judgeSummary: judgeJson.card.summary,
      matchedRules: judgeJson.card.matched_rules.map((rule) => rule.source_post_no).slice(0, 5)
    }, null, 2));
  } finally {
    if (context) await context.close();
    backend.kill();
    staticServer.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
