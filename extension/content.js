(function () {
  "use strict";

  if (window.__dcMavenContentLoaded) {
    return;
  }
  window.__dcMavenContentLoaded = true;

  const DENIED_TERMS = [
    "삭제", "차단", "등록", "작성완료", "댓글등록", "확인", "저장", "적용", "전송", "완료", "게시", "발행",
    "delete", "remove", "ban", "block", "submit", "post", "comment", "confirm", "save", "apply", "send", "publish"
  ];

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function textOf(element) {
    return normalize(element && element.textContent);
  }

  function first(selector, root = document) {
    return root.querySelector(selector);
  }

  function all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function isVisible(element) {
    if (!element || !(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function inViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
  }

  function getUrlParam(name) {
    try {
      return new URL(location.href).searchParams.get(name) || undefined;
    } catch {
      return undefined;
    }
  }

  function parseCount(pattern, text) {
    return text.match(pattern)?.[1];
  }

  function getTitle() {
    return textOf(first(".title_subject")) || textOf(first(".gallview_head .title")) || document.title;
  }

  function getHead() {
    return textOf(first(".title_headtext, .title_head, .headtext"));
  }

  function getAuthorFromElement(writer) {
    if (!writer) return undefined;
    const name = textOf(first(".nickname, .name, .writer_nikcon", writer)) || textOf(writer);
    return {
      name,
      uid: writer.getAttribute("data-uid") || writer.getAttribute("data-user-id") || undefined,
      ip: writer.getAttribute("data-ip") || writer.querySelector("[data-ip]")?.getAttribute("data-ip") || undefined,
      raw: textOf(writer)
    };
  }

  function getAuthor() {
    return getAuthorFromElement(first(".gall_writer, .ub-writer, [data-uid], .writer"));
  }

  function getCommentNodes() {
    return all(".cmt_list li, .comment_wrap .ub-content, [id^='comment_li_'], [id^='reply_li_']");
  }

  function getCommentAuthorElement(node) {
    return first(".nickname, .name, .user_name, .gall_writer, .writer_nikcon, [data-uid], [data-user-id]", node);
  }

  function getBodyRoot() {
    return first(".write_div, .writing_view_box, .view_content_wrap article, article");
  }

  function getCounts() {
    const meta = textOf(first(".gallview_head, .view_content_wrap")) || document.body.innerText;
    return {
      views: textOf(first(".gall_count, .view_count")) || parseCount(/조회\s*([0-9,]+)/u, meta),
      recommends: textOf(first(".gall_recommend, .recommend")) || parseCount(/추천\s*([0-9,]+)/u, meta),
      comments: textOf(first(".gall_comment, .comment_count")) || parseCount(/댓글\s*([0-9,]+)/u, meta)
    };
  }

  function getComments() {
    const seen = new Set();
    return getCommentNodes()
      .filter((node) => {
        const id = node.id || textOf(node).slice(0, 80);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((node) => {
        const textNode = first(".usertxt, .comment_content, .txt, p", node);
        const id = node.id || undefined;
        const authorIdentity = getAuthorFromElement(node);
        return {
          id,
          author: authorIdentity?.name || textOf(getCommentAuthorElement(node)),
          authorIdentity,
          date: textOf(first(".date_time, .gall_date, .date", node)),
          text: textOf(textNode) || textOf(node),
          depth: id?.startsWith("reply") || node.classList.contains("reply") || Boolean(node.closest(".reply_box")) ? 1 : 0
        };
      })
      .filter((comment) => comment.text);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(predicate, timeoutMs = 1200) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const value = predicate();
      if (value) return value;
      await sleep(80);
    }
    return undefined;
  }

  function visibleTextElements() {
    return all("h1, h2, h3, h4, strong, b, span, p, div, label, a, button")
      .filter((element) => element instanceof HTMLElement && isVisible(element));
  }

  function findClickableByText(pattern) {
    return all("a, button, [role='button'], li, span")
      .filter((element) => element instanceof HTMLElement && isVisible(element))
      .find((element) => pattern.test(textOf(element)));
  }

  function findMemoUid() {
    for (const element of visibleTextElements()) {
      const match = textOf(element).match(/([A-Za-z][A-Za-z0-9_-]{2,})\s*메모/u);
      if (match?.[1] && !/user|member|memo/i.test(match[1])) return match[1];
    }
    return undefined;
  }

  async function resolveCommentUidFromMemo(commentNode) {
    const authorElement = getCommentAuthorElement(commentNode);
    if (!(authorElement instanceof HTMLElement)) return undefined;
    authorElement.click();
    const memoButton = await waitFor(() => findClickableByText(/이용자\s*메모/u));
    if (!(memoButton instanceof HTMLElement)) return undefined;
    memoButton.click();
    return waitFor(findMemoUid, 1600);
  }

  async function resolveCommentUids(observation) {
    const sourceObservation = observation || collectObservation();
    const comments = (sourceObservation.comments || []).map((comment) => ({
      ...comment,
      authorIdentity: comment.authorIdentity ? { ...comment.authorIdentity } : undefined
    }));
    const nodes = getCommentNodes();

    for (let index = 0; index < comments.length; index += 1) {
      const comment = comments[index];
      if (comment.authorIdentity?.uid) continue;
      const node = (comment.id && document.getElementById(comment.id)) || nodes[index];
      if (!node) continue;
      const uid = await resolveCommentUidFromMemo(node);
      if (!uid) continue;
      const authorIdentity = comment.authorIdentity || getAuthorFromElement(node) || { name: comment.author || undefined };
      comment.authorIdentity = {
        ...authorIdentity,
        uid,
        raw: normalize(`${authorIdentity.raw || comment.author || ""} uid:${uid}`)
      };
    }

    return {
      ...sourceObservation,
      comments
    };
  }

  function isLikelyAdImage(image) {
    const src = String(image.currentSrc || image.src || "").toLowerCase();
    const alt = String(image.alt || image.getAttribute("title") || "").toLowerCase();
    const context = String([
      image.id,
      image.className,
      image.closest("[id], [class]")?.id,
      image.closest("[id], [class]")?.className,
      image.closest("aside, iframe, ins, [data-ad], .adsbygoogle, .ad_wrap, .ad_box, .banner, .advertise, .sponsor")?.outerHTML?.slice(0, 300)
    ].filter(Boolean).join(" ")).toLowerCase();
    const haystack = `${src} ${alt} ${context}`;
    if (/(^|[/_.-])(ad|ads|adn|banner|sponsor|advert|doubleclick|googlesyndication|adfit|criteo|taboola|outbrain)([/_.-]|$)/iu.test(haystack)) {
      return true;
    }
    if (image.closest("aside, iframe, ins, [data-ad], .adsbygoogle, .ad_wrap, .ad_box, .banner, .advertise, .sponsor")) {
      return true;
    }
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width > 0 && height > 0 && (width <= 8 || height <= 8)) {
      return true;
    }
    return false;
  }

  function getImages(bodyRoot) {
    if (!bodyRoot) return [];
    return all("img", bodyRoot).filter((image) => !isLikelyAdImage(image)).map((image) => ({
      src: image.currentSrc || image.src,
      alt: image.alt || image.getAttribute("title") || "",
      nearbyText: normalize(image.closest("p, div, figure, article, section")?.textContent || "")
    })).filter((image) => image.src);
  }

  function getLinks(bodyRoot) {
    if (!bodyRoot) return [];
    return all("a[href]", bodyRoot).map((link) => ({
      href: link.href,
      text: textOf(link)
    })).filter((link) => link.href);
  }

  function getViewportText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const pieces = [];
    let node = walker.currentNode;
    while (node) {
      if (node instanceof HTMLElement && isVisible(node) && inViewport(node)) {
        const text = textOf(node);
        if (text && text.length < 500 && !pieces.includes(text)) pieces.push(text);
      }
      node = walker.nextNode();
    }
    return pieces.join("\n").slice(0, 6000);
  }

  function getClickableLabels() {
    return all("a, button, input, textarea, select, [role='button'], [onclick]")
      .filter((element) => element instanceof HTMLElement && isVisible(element) && inViewport(element))
      .map((element) => normalize(
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.getAttribute("alt") ||
        element.getAttribute("value") ||
        element.textContent
      ))
      .filter(Boolean)
      .slice(0, 80);
  }

  function collectObservation() {
    const bodyRoot = getBodyRoot();
    const textRoot = bodyRoot || document.body;
    const bodyText = textOf(bodyRoot);
    return {
      url: location.href,
      title: getTitle(),
      galleryId: getUrlParam("id"),
      postNo: getUrlParam("no"),
      head: getHead() || undefined,
      author: getAuthor(),
      createdAtText: textOf(first(".gall_date, .date_time, .date")) || undefined,
      counts: getCounts(),
      bodyText: bodyText || textOf(textRoot),
      htmlExcerpt: normalize(textRoot.innerHTML).slice(0, 12000),
      comments: getComments(),
      images: getImages(bodyRoot),
      links: getLinks(bodyRoot),
      selectedText: String(window.getSelection?.() || "").trim(),
      viewportText: getViewportText(),
      clickableLabels: getClickableLabels(),
      metadata: {
        capturedAt: new Date().toISOString(),
        domSource: "dcinside-maven-content-script",
        documentTitle: document.title
      }
    };
  }

  function isDeniedLabel(label) {
    const normalized = normalize(label).toLowerCase().replace(/\s+/g, "");
    return DENIED_TERMS.some((term) => normalized.includes(term.toLowerCase().replace(/\s+/g, "")));
  }

  function safeAction(action) {
    const label = String(action.label || "");
    const selector = String(action.selector || "");
    if (["submit", "delete", "ban", "post", "comment", "confirm"].includes(action.kind)) {
      return { allowed: false, reason: `Blocked irreversible kind: ${action.kind}` };
    }
    if (isDeniedLabel(label)) {
      return { allowed: false, reason: `Blocked irreversible label: ${label}` };
    }
    if (/button\[type=['"]?submit|input\[type=['"]?submit|delete|ban/iu.test(selector)) {
      return { allowed: false, reason: `Blocked irreversible selector: ${selector}` };
    }

    const target = selector ? document.querySelector(selector) : undefined;
    if (action.kind === "prefill") {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return { allowed: false, reason: "Prefill target is not an input or textarea" };
      }
      target.value = String(action.value || "");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { allowed: true };
    }
    if (action.kind === "scroll") {
      target?.scrollIntoView({ block: "center" });
      return { allowed: true };
    }
    if (action.kind === "click") {
      if (!(target instanceof HTMLElement)) return { allowed: false, reason: "Click target not found" };
      target.click();
      return { allowed: true };
    }
    return { allowed: true };
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "MAVEN_COLLECT_OBSERVATION") {
        sendResponse({ ok: true, observation: collectObservation() });
        return true;
      }
      if (message?.type === "MAVEN_RESOLVE_COMMENT_UIDS") {
        resolveCommentUids(message.observation).then((observation) => {
          sendResponse({ ok: true, observation });
        }).catch((error) => {
          sendResponse({ ok: false, reason: String(error?.message || error), observation: message.observation || collectObservation() });
        });
        return true;
      }
      if (message?.type === "MAVEN_SAFE_ACTION") {
        sendResponse(safeAction(message.action || {}));
        return true;
      }
      return false;
    });
  }

  window.__dcMavenCollectObservationForTest = collectObservation;
  window.__dcMavenResolveCommentUidsForTest = resolveCommentUids;
  window.__dcMavenSafeActionForTest = safeAction;
})();
