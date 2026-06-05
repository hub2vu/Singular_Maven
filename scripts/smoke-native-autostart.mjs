import { chromium } from "playwright";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const extensionPath = path.join(repoRoot, "extension");
const fixturePath = path.join(repoRoot, "tests", "fixtures", "dcinside-post.html");
const backendPort = 8792;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

function killPort(port) {
  const command = `$ErrorActionPreference='SilentlyContinue'; $c=Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force }; exit 0`;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { stdio: "pipe" });
  } catch {
    // best-effort cleanup
  }
}

async function withTimeout(label, promise, ms = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForBackend(port) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return await response.json();
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Backend port ${port} did not become ready`);
}

async function main() {
  process.env.MAVEN_ALLOW_MOCK_LLM = "1";
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "install-native-host.mjs")], { cwd: repoRoot, stdio: "pipe" });
  killPort(backendPort);

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
  await listen(staticServer, 8793);

  const userDataDir = await mkdtemp(path.join(tmpdir(), "maven-native-autostart-"));
  let context;
  let result;
  try {
    context = await withTimeout("launchPersistentContext", chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    }), 20_000);
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    }
    const extensionId = new URL(worker.url()).host;

    const fixturePage = await context.newPage();
    await fixturePage.goto("http://127.0.0.1:8793/dcinside-post.html");
    const observation = await fixturePage.evaluate(() => ({
      url: location.href,
      title: document.querySelector(".title_subject")?.textContent?.trim() || document.title,
      galleryId: "thesingularity",
      postNo: "777777",
      head: "일반",
      author: { name: "테스터" },
      bodyText: document.querySelector(".write_div")?.textContent?.trim() || "",
      htmlExcerpt: document.querySelector(".write_div")?.innerHTML || "",
      comments: Array.from(document.querySelectorAll(".cmt_list li")).map((item, index) => ({
        id: item.id || `c${index}`,
        author: item.querySelector(".name")?.textContent?.trim() || "",
        text: item.querySelector(".usertxt")?.textContent?.trim() || item.textContent?.trim() || "",
        depth: item.id.startsWith("reply") ? 1 : 0
      })),
      images: Array.from(document.querySelectorAll(".write_div img")).map((image) => ({ src: image.src, alt: image.alt || "" })),
      links: Array.from(document.querySelectorAll(".write_div a")).map((link) => ({ href: link.href, text: link.textContent?.trim() || "" })),
      selectedText: "",
      viewportText: document.body.innerText,
      clickableLabels: [],
      metadata: {}
    }));

    const sidePanel = await context.newPage();
    await sidePanel.addInitScript(({ port, observation }) => {
      localStorage.setItem("mavenBackendUrl", `http://127.0.0.1:${port}`);
      window.__DC_MAVEN_TEST__ = {
        sendMessage: async (message) => {
          if (message.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
            return { ok: true, observation, screenshotDataUrl: null };
          }
          return chrome.runtime.sendMessage(message);
        }
      };
    }, { port: backendPort, observation });
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidePanel.getByRole("button", { name: /이 페이지 LLM 판단/ }).click();
    try {
      await sidePanel.getByText("final_human_decision_required: true").waitFor({ timeout: 30_000 });
    } catch (error) {
      const errorText = await sidePanel.locator("#errorPanel").textContent().catch(() => "");
      const statusText = await sidePanel.locator("#authStatus").textContent().catch(() => "");
      throw new Error(`Side panel did not render card. status=${statusText} error=${errorText} cause=${error?.message || error}`);
    }
    const health = await waitForBackend(backendPort);

    result = {
      ok: true,
      extensionId,
      autoStartedBackendPort: backendPort,
      health,
      sidePanelJudgeRendered: true
    };
  } finally {
    if (result) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    if (context) {
      await withTimeout("context.close", context.close(), 10_000).catch(() => {});
    }
    await new Promise((resolve) => staticServer.close(resolve));
    killPort(backendPort);
    await withTimeout("rm userDataDir", rm(userDataDir, { recursive: true, force: true }), 10_000).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  try {
    killPort(backendPort);
  } catch {
    // ignore cleanup failure
  }
  process.exit(1);
});
