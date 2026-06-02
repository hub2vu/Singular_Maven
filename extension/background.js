const DENIED_TERMS = [
  "삭제", "차단", "등록", "작성완료", "댓글등록", "확인", "저장", "적용", "전송", "완료", "게시", "발행",
  "delete", "remove", "ban", "block", "submit", "post", "comment", "confirm", "save", "apply", "send", "publish"
];
const NATIVE_BACKEND_HOST = "com.dcinside_maven_copilot.backend";

function denied(label) {
  const normalized = String(label || "").toLowerCase().replace(/\s+/g, "");
  return DENIED_TERMS.some((term) => normalized.includes(term.toLowerCase().replace(/\s+/g, "")));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return tab;
}

function isMissingReceiverError(error) {
  const message = String(error?.message || error);
  return message.includes("Receiving end does not exist") || message.includes("Could not establish connection");
}

function canInjectContentScript(tab) {
  return /^https?:\/\//u.test(tab.url || "") || /^file:\/\//u.test(tab.url || "");
}

async function sendMessageWithContentScript(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }
    if (!canInjectContentScript(tab)) {
      throw new Error("현재 탭에는 content script를 주입할 수 없습니다. DCInside 글 페이지를 연 뒤 다시 시도하세요.");
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    return await chrome.tabs.sendMessage(tab.id, message);
  }
}

async function observeActiveTab() {
  const tab = await activeTab();
  let observed = await sendMessageWithContentScript(tab, { type: "MAVEN_COLLECT_OBSERVATION" });
  try {
    const uidResolved = await sendMessageWithContentScript(tab, {
      type: "MAVEN_RESOLVE_COMMENT_UIDS",
      observation: observed.observation
    });
    if (uidResolved?.ok && uidResolved.observation) {
      observed = { ...observed, observation: uidResolved.observation };
    } else if (uidResolved?.reason) {
      observed = { ...observed, uidResolutionError: uidResolved.reason };
    }
  } catch (error) {
    observed = { ...observed, uidResolutionError: String(error?.message || error) };
  }
  try {
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { ...observed, screenshotDataUrl };
  } catch (error) {
    return {
      ...observed,
      screenshotDataUrl: null,
      screenshotError: String(error?.message || error)
    };
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

async function imageToDataUrl(image, pageUrl) {
  const response = await fetch(image.src, {
    credentials: "include",
    referrer: pageUrl || undefined
  });
  if (!response.ok) {
    throw new Error(`image fetch failed ${response.status}`);
  }
  const blob = await response.blob();
  if (!String(blob.type || "").startsWith("image/")) {
    throw new Error(`image fetch returned non-image content-type: ${blob.type || "unknown"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type};base64,${bytesToBase64(bytes)}`;
}

async function inlineImageUrls(images, pageUrl) {
  const inlined = [];
  const failures = [];
  for (const image of images || []) {
    try {
      inlined.push({
        ...image,
        dataUrl: image.dataUrl || await imageToDataUrl(image, pageUrl)
      });
    } catch (error) {
      failures.push({ src: image.src, reason: String(error?.message || error) });
    }
  }
  return { ok: inlined.length > 0, images: inlined, failures };
}

async function safeActionOnActiveTab(action) {
  if (["submit", "delete", "ban", "post", "comment", "confirm"].includes(action?.kind) || denied(action?.label)) {
    return { allowed: false, reason: "Blocked irreversible action in background denylist" };
  }
  const tab = await activeTab();
  return sendMessageWithContentScript(tab, { type: "MAVEN_SAFE_ACTION", action });
}

function ensureBackendWithNativeHost(backendUrl) {
  return new Promise((resolve) => {
    if (!chrome.runtime.sendNativeMessage) {
      resolve({ ok: false, reason: "nativeMessaging permission is unavailable" });
      return;
    }
    chrome.runtime.sendNativeMessage(
      NATIVE_BACKEND_HOST,
      { type: "ensureBackend", backendUrl: backendUrl || "http://127.0.0.1:8787" },
      (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve({ ok: false, reason: lastError.message || String(lastError) });
          return;
        }
        resolve(response || { ok: false, reason: "Native host returned no response" });
      }
    );
  });
}

function ensureOpenAIOAuthProxyWithNativeHost() {
  return new Promise((resolve) => {
    if (!chrome.runtime.sendNativeMessage) {
      resolve({ ok: false, reason: "nativeMessaging permission is unavailable" });
      return;
    }
    chrome.runtime.sendNativeMessage(
      NATIVE_BACKEND_HOST,
      { type: "ensureOpenAIOAuthProxy" },
      (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve({ ok: false, reason: lastError.message || String(lastError) });
          return;
        }
        resolve(response || { ok: false, reason: "Native host returned no response" });
      }
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "MAVEN_OBSERVE_ACTIVE_TAB") {
      sendResponse(await observeActiveTab());
      return;
    }
    if (message?.type === "MAVEN_SAFE_ACTION") {
      sendResponse(await safeActionOnActiveTab(message.action || {}));
      return;
    }
    if (message?.type === "MAVEN_INLINE_IMAGE_URLS") {
      sendResponse(await inlineImageUrls(message.images || [], message.pageUrl));
      return;
    }
    if (message?.type === "MAVEN_ENSURE_BACKEND") {
      sendResponse(await ensureBackendWithNativeHost(message.backendUrl));
      return;
    }
    if (message?.type === "MAVEN_ENSURE_OPENAI_OAUTH_PROXY") {
      sendResponse(await ensureOpenAIOAuthProxyWithNativeHost());
      return;
    }
    if (message?.type === "MAVEN_OPEN_TAB") {
      if (denied(message.label)) {
        sendResponse({ ok: false, reason: "Blocked irreversible open-tab label" });
        return;
      }
      await chrome.tabs.create({ url: message.url });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "MAVEN_SAVE_SCREENSHOT") {
      await chrome.downloads.download({
        url: message.screenshotDataUrl,
        filename: message.filename || "dcinside-maven-evidence.png",
        saveAs: true
      });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, reason: "Unknown message" });
  })().catch((error) => sendResponse({ ok: false, reason: String(error?.message || error) }));
  return true;
});
