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

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findVisibleListPost(posts, title) {
  const needle = normalizeTitle(title);
  if (!needle) return undefined;
  const candidates = (posts || []).filter((post) => post?.title && post?.url);
  return candidates.find((post) => normalizeTitle(post.title) === needle) ||
    candidates.find((post) => normalizeTitle(post.title).includes(needle)) ||
    candidates.find((post) => needle.includes(normalizeTitle(post.title)));
}

async function collectVisibleListPostsFromActiveTab() {
  const tab = await activeTab();
  const result = await sendMessageWithContentScript(tab, { type: "MAVEN_COLLECT_VISIBLE_LIST_POSTS" });
  if (!result?.ok) {
    throw new Error(result?.reason || "visible list posts could not be collected");
  }
  return result;
}

function waitForTabComplete(tab) {
  if (!tab?.id || tab.status === "complete" || !chrome.tabs.onUpdated?.addListener) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      chrome.tabs.onUpdated?.removeListener?.(listener);
      resolve();
    };
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo?.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    if (typeof setTimeout === "function") {
      setTimeout(finish, 15000);
    }
  });
}

async function observeUrlInInactiveTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab?.id) {
    throw new Error("inactive tab could not be created");
  }
  const targetTab = { ...tab, url: tab.url || url };
  try {
    await waitForTabComplete(targetTab);
    const observed = await sendMessageWithContentScript(targetTab, { type: "MAVEN_COLLECT_OBSERVATION" });
    if (!observed?.ok) {
      throw new Error(observed?.reason || "inactive tab observation failed");
    }
    return observed;
  } finally {
    if (chrome.tabs.remove) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function observeListPostByTitle(title) {
  const listResult = await collectVisibleListPostsFromActiveTab();
  const listPost = findVisibleListPost(listResult.posts, title);
  if (!listPost) {
    return {
      ok: false,
      reason: `No visible list post matched title: ${title || ""}`,
      candidates: (listResult.posts || []).slice(0, 20).map((post) => post.title)
    };
  }
  if (!listPost.hasImage) {
    return {
      ok: false,
      reason: `Matched list post has no attached-image marker: ${listPost.title}`,
      listPost
    };
  }
  const observed = await observeUrlInInactiveTab(listPost.url);
  return {
    ok: true,
    listPost,
    observation: observed.observation
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

function imageMimeFromSource(src, fallbackType) {
  if (String(fallbackType || "").startsWith("image/")) return fallbackType;
  try {
    const url = new URL(src);
    const filename = decodeURIComponent(url.searchParams.get("f_no") || url.pathname);
    const extension = filename.match(/\.([a-z0-9]+)(?:$|[?#])/iu)?.[1]?.toLowerCase();
    const mimeByExtension = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      avif: "image/avif"
    };
    return extension ? mimeByExtension[extension] : undefined;
  } catch {
    return undefined;
  }
}

async function imageToDataUrl(image, pageUrl) {
  if (isPageUrlImageCandidate(image.src, pageUrl)) {
    throw new Error("skipped page URL because it is not an image source");
  }
  const response = await fetch(image.src, {
    credentials: "include",
    referrer: pageUrl || undefined
  });
  if (!response.ok) {
    throw new Error(`image fetch failed ${response.status}`);
  }
  const blob = await response.blob();
  const mimeType = imageMimeFromSource(image.src, blob.type);
  if (!mimeType) {
    throw new Error(`image fetch returned non-image content-type: ${blob.type || "unknown"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("image fetch returned empty image bytes");
  }
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function isPageUrlImageCandidate(src, pageUrl) {
  if (!src) return true;
  try {
    const source = new URL(src, pageUrl || undefined);
    const page = pageUrl ? new URL(pageUrl) : undefined;
    if (page && source.href === page.href) return true;
    return /(^|\.)gall\.dcinside\.com$/iu.test(source.hostname) && /\/board\/view\//iu.test(source.pathname);
  } catch {
    return true;
  }
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
    if (message?.type === "MAVEN_OBSERVE_LIST_POST_BY_TITLE") {
      sendResponse(await observeListPostByTitle(message.title));
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
