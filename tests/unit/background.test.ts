import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

interface FakeChrome {
  runtime: {
    onInstalled: { addListener: (listener: () => void) => void };
    onMessage: { addListener: (listener: (message: any, sender: any, sendResponse: (response: any) => void) => boolean) => void };
    sendNativeMessage?: (hostName: string, message: any, callback: (response: any) => void) => void;
    lastError?: { message: string };
  };
  sidePanel: { setPanelBehavior: () => Promise<void> };
  tabs: {
    query: () => Promise<Array<{ id: number; windowId: number; url: string }>>;
    sendMessage: (tabId: number, message: any) => Promise<any>;
    captureVisibleTab: () => Promise<string>;
    create: (details?: any) => Promise<{ id?: number; windowId?: number; url?: string; status?: string } | void>;
    remove?: (tabId: number) => Promise<void>;
    onUpdated?: {
      addListener: (listener: (tabId: number, changeInfo: any, tab: any) => void) => void;
      removeListener: (listener: (tabId: number, changeInfo: any, tab: any) => void) => void;
    };
  };
  scripting: {
    executeScript: (details: any) => Promise<void>;
  };
  downloads: {
    download: () => Promise<number>;
  };
}

async function loadBackground(chrome: FakeChrome, extraContext: Record<string, unknown> = {}) {
  const code = await readFile(path.join(repoRoot, "extension/background.js"), "utf8");
  let listener: ((message: any, sender: any, sendResponse: (response: any) => void) => boolean) | undefined;
  chrome.runtime.onMessage.addListener = (registered) => {
    listener = registered;
  };
  vm.runInNewContext(code, { chrome, console, Promise, String, setTimeout, ...extraContext }, { filename: "background.js" });
  if (!listener) throw new Error("background listener was not registered");
  return listener;
}

async function sendToBackground(listener: (message: any, sender: any, sendResponse: (response: any) => void) => boolean, message: any) {
  return await new Promise<any>((resolve) => {
    const asyncResponse = listener(message, {}, resolve);
    expect(asyncResponse).toBe(true);
  });
}

describe("background content-script connection", () => {
  it("injects content.js and retries when tabs.sendMessage has no receiving end", async () => {
    let attempts = 0;
    let injected = 0;
    const messageTypes: string[] = [];
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1" }],
        sendMessage: async (_tabId, message) => {
          attempts += 1;
          messageTypes.push(message.type);
          if (attempts === 1) {
            throw new Error("Could not establish connection. Receiving end does not exist.");
          }
          return { ok: true, observation: { title: "after injection" } };
        },
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async () => {}
      },
      scripting: {
        executeScript: async (details) => {
          injected += 1;
          expect(details.target.tabId).toBe(7);
          expect(details.files).toEqual(["content.js"]);
        }
      },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome);
    const response = await sendToBackground(listener, { type: "MAVEN_OBSERVE_ACTIVE_TAB" });

    expect(injected).toBe(1);
    expect(attempts).toBe(3);
    expect(messageTypes).toEqual(["MAVEN_COLLECT_OBSERVATION", "MAVEN_COLLECT_OBSERVATION", "MAVEN_RESOLVE_COMMENT_UIDS"]);
    expect(response.ok).toBe(true);
    expect(response.observation.title).toBe("after injection");
  });

  it("asks the native host to ensure the backend is running", async () => {
    let nativeHostName = "";
    let nativePayload: any;
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} },
        sendNativeMessage: (hostName, message, callback) => {
          nativeHostName = hostName;
          nativePayload = message;
          callback({ ok: true, started: true, health: { ok: true } });
        }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1" }],
        sendMessage: async () => ({ ok: true }),
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async () => {}
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome);
    const response = await sendToBackground(listener, { type: "MAVEN_ENSURE_BACKEND", backendUrl: "http://127.0.0.1:8787" });

    expect(nativeHostName).toBe("com.dcinside_maven_copilot.backend");
    expect(nativePayload).toMatchObject({ type: "ensureBackend", backendUrl: "http://127.0.0.1:8787" });
    expect(response.ok).toBe(true);
    expect(response.started).toBe(true);
  });

  it("does not fetch the current page URL as an uploaded image", async () => {
    let fetchCalled = false;
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1" }],
        sendMessage: async () => ({ ok: true }),
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async () => {}
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const pageUrl = "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1226994&page=1";
    const listener = await loadBackground(chrome, {
      fetch: async () => {
        fetchCalled = true;
        throw new Error("fetch should not be called for page URLs");
      }
    });
    const response = await sendToBackground(listener, {
      type: "MAVEN_INLINE_IMAGE_URLS",
      pageUrl,
      images: [{ src: pageUrl, alt: "resolved empty src" }]
    });

    expect(fetchCalled).toBe(false);
    expect(response.ok).toBe(false);
    expect(response.failures[0]).toMatchObject({ src: pageUrl });
    expect(response.failures[0].reason).toContain("page URL");
  });

  it("inlines DCInside original attachment downloads using the filename extension when content-type is generic", async () => {
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1" }],
        sendMessage: async () => ({ ok: true }),
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async () => {}
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome, {
      URL,
      Uint8Array,
      fetch: async () => ({
        ok: true,
        blob: async () => ({
          type: "application/octet-stream",
          arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer
        })
      }),
      globalThis: {
        btoa: (value: string) => Buffer.from(value, "binary").toString("base64")
      }
    });
    const response = await sendToBackground(listener, {
      type: "MAVEN_INLINE_IMAGE_URLS",
      pageUrl: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1226994&page=1",
      images: [{
        src: "https://image.dcinside.com/download.php?no=abc123&f_no=image.png",
        alt: "image.png"
      }]
    });

    expect(response.ok).toBe(true);
    expect(response.images[0].dataUrl).toBe("data:image/png;base64,iVBORw==");
  });

  it("inlines extensionless DCInside viewimage downloads by sniffing image bytes", async () => {
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1227710" }],
        sendMessage: async () => ({ ok: true }),
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async () => {}
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome, {
      URL,
      Uint8Array,
      fetch: async () => ({
        ok: true,
        blob: async () => ({
          type: "application/octet-stream",
          arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer
        })
      }),
      globalThis: {
        btoa: (value: string) => Buffer.from(value, "binary").toString("base64")
      }
    });
    const response = await sendToBackground(listener, {
      type: "MAVEN_INLINE_IMAGE_URLS",
      pageUrl: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1227710&page=1",
      images: [{
        src: "https://dcimg8.dcinside.co.kr/viewimage.php?no=bodyimage123",
        alt: "body upload"
      }]
    });

    expect(response.ok).toBe(true);
    expect(response.images[0].dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("rejects empty image downloads before building OpenAI image data URLs", async () => {
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1" }],
        sendMessage: async () => ({ ok: true }),
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async () => {}
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome, {
      URL,
      Uint8Array,
      fetch: async () => ({
        ok: true,
        blob: async () => ({
          type: "application/octet-stream",
          arrayBuffer: async () => new ArrayBuffer(0)
        })
      }),
      globalThis: {
        btoa: (value: string) => Buffer.from(value, "binary").toString("base64")
      }
    });
    const response = await sendToBackground(listener, {
      type: "MAVEN_INLINE_IMAGE_URLS",
      pageUrl: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1226994&page=1",
      images: [{
        src: "https://image.dcinside.com/download.php?no=abc123&f_no=image.png",
        alt: "image.png"
      }]
    });

    expect(response.ok).toBe(false);
    expect(response.failures[0].reason).toContain("empty image bytes");
  });

  it("asks the native host to start only the OpenAI OAuth proxy", async () => {
    let nativeHostName = "";
    let nativePayload: any;
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} },
        sendNativeMessage: (hostName, message, callback) => {
          nativeHostName = hostName;
          nativePayload = message;
          callback({ ok: true, proxyReady: true, proxyCommand: "npx -y openai-oauth --port 10531" });
        }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1" }],
        sendMessage: async () => ({ ok: true }),
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async () => {}
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome);
    const response = await sendToBackground(listener, { type: "MAVEN_ENSURE_OPENAI_OAUTH_PROXY" });

    expect(nativeHostName).toBe("com.dcinside_maven_copilot.backend");
    expect(nativePayload).toMatchObject({ type: "ensureOpenAIOAuthProxy" });
    expect(response.ok).toBe(true);
    expect(response.proxyCommand).toBe("npx -y openai-oauth --port 10531");
  });

  it("opens a matched visible list post in an inactive tab and observes its uploaded images", async () => {
    const createdTabs: any[] = [];
    const removedTabs: number[] = [];
    const activeListPosts = [
      {
        title: "Photo briefing target [12]",
        url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1227001&page=1",
        postNo: "1227001",
        hasImage: true
      }
    ];
    const postObservation = {
      url: activeListPosts[0].url,
      title: "Photo briefing target",
      images: [{ src: "https://image.dcinside.com/download.php?no=abc123&f_no=image.png", alt: "image.png" }]
    };
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/lists/?id=thesingularity" }],
        sendMessage: async (tabId, message) => {
          if (tabId === 7 && message.type === "MAVEN_COLLECT_VISIBLE_LIST_POSTS") {
            return { ok: true, posts: activeListPosts };
          }
          if (tabId === 99 && message.type === "MAVEN_COLLECT_OBSERVATION") {
            return { ok: true, observation: postObservation };
          }
          throw new Error(`unexpected message ${tabId}:${message.type}`);
        },
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async (details) => {
          createdTabs.push(details);
          return { id: 99, windowId: 1, url: details.url, status: "loading" };
        },
        remove: async (tabId) => {
          removedTabs.push(tabId);
        },
        onUpdated: {
          addListener: (listener) => {
            listener(99, { status: "complete" }, { id: 99, windowId: 1, url: activeListPosts[0].url });
          },
          removeListener: () => {}
        }
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome);
    const response = await sendToBackground(listener, { type: "MAVEN_OBSERVE_LIST_POST_BY_TITLE", title: "Photo briefing target ##" });

    expect(response.ok).toBe(true);
    expect(response.listPost.postNo).toBe("1227001");
    expect(response.observation).toEqual(postObservation);
    expect(createdTabs).toEqual([{ url: activeListPosts[0].url, active: false }]);
    expect(removedTabs).toEqual([99]);
  });

  it("ignores standalone comment-count links when matching list post titles", async () => {
    const createdTabs: any[] = [];
    const activeListPosts = [
      {
        title: "[9]",
        url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1227715&t=cv&page=1",
        postNo: "1227715",
        hasImage: true
      },
      {
        title: "유럽도 소버린AI 준비하네",
        url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1227715&page=1",
        postNo: "1227715",
        hasImage: true
      }
    ];
    const postObservation = {
      url: activeListPosts[1].url,
      title: "유럽도 소버린AI 준비하네",
      images: [{ src: "https://dcimg8.dcinside.co.kr/viewimage.php?no=bodyimage123", alt: "body upload" }]
    };
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/lists/?id=thesingularity" }],
        sendMessage: async (tabId, message) => {
          if (tabId === 7 && message.type === "MAVEN_COLLECT_VISIBLE_LIST_POSTS") {
            return { ok: true, posts: activeListPosts };
          }
          if (tabId === 99 && message.type === "MAVEN_COLLECT_OBSERVATION") {
            return { ok: true, observation: postObservation };
          }
          throw new Error(`unexpected message ${tabId}:${message.type}`);
        },
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async (details) => {
          createdTabs.push(details);
          return { id: 99, windowId: 1, url: details.url, status: "complete" };
        },
        remove: async () => {},
        onUpdated: {
          addListener: () => {},
          removeListener: () => {}
        }
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome);
    const response = await sendToBackground(listener, { type: "MAVEN_OBSERVE_LIST_POST_BY_TITLE", title: "유럽도 소버린AI 준비하네 [9]" });

    expect(response.ok).toBe(true);
    expect(response.listPost.title).toBe("유럽도 소버린AI 준비하네");
    expect(createdTabs).toEqual([{ url: activeListPosts[1].url, active: false }]);
  });

  it("retries inactive-tab observation when a matched image post initially exposes no images", async () => {
    let postObservationCalls = 0;
    const activeListPosts = [{
      title: "유럽도 소버린AI 준비하네",
      url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1227715&page=1",
      postNo: "1227715",
      hasImage: true
    }];
    const chrome: FakeChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      sidePanel: { setPanelBehavior: async () => {} },
      tabs: {
        query: async () => [{ id: 7, windowId: 1, url: "https://gall.dcinside.com/mgallery/board/lists/?id=thesingularity" }],
        sendMessage: async (tabId, message) => {
          if (tabId === 7 && message.type === "MAVEN_COLLECT_VISIBLE_LIST_POSTS") {
            return { ok: true, posts: activeListPosts };
          }
          if (tabId === 99 && message.type === "MAVEN_COLLECT_OBSERVATION") {
            postObservationCalls += 1;
            return {
              ok: true,
              observation: {
                url: activeListPosts[0].url,
                title: "유럽도 소버린AI 준비하네",
                images: postObservationCalls === 1 ? [] : [{ src: "https://dcimg8.dcinside.co.kr/viewimage.php?no=bodyimage123", alt: "body upload" }]
              }
            };
          }
          throw new Error(`unexpected message ${tabId}:${message.type}`);
        },
        captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
        create: async (details) => ({ id: 99, windowId: 1, url: details.url, status: "complete" }),
        remove: async () => {},
        onUpdated: {
          addListener: () => {},
          removeListener: () => {}
        }
      },
      scripting: { executeScript: async () => {} },
      downloads: { download: async () => 1 }
    };

    const listener = await loadBackground(chrome);
    const response = await sendToBackground(listener, { type: "MAVEN_OBSERVE_LIST_POST_BY_TITLE", title: "유럽도 소버린AI 준비하네 [9]" });

    expect(response.ok).toBe(true);
    expect(response.observation.images).toHaveLength(1);
    expect(postObservationCalls).toBe(2);
  });
});
