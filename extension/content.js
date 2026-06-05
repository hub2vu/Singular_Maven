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
    const identityRoot = writer.matches?.(".gall_writer, .ub-writer, [data-uid], [data-user-id], [data-ip]")
      ? writer
      : first(".gall_writer, .ub-writer, [data-uid], [data-user-id], [data-ip]", writer);
    const nameRoot = identityRoot || writer;
    const name = textOf(first(".nickname, .name, .writer_nikcon", nameRoot)) ||
      normalize(nameRoot.getAttribute?.("data-nick")) ||
      textOf(nameRoot);
    return {
      name,
      uid: identityRoot?.getAttribute("data-uid") ||
        identityRoot?.getAttribute("data-user-id") ||
        writer.getAttribute("data-uid") ||
        writer.getAttribute("data-user-id") ||
        writer.querySelector("[data-uid]")?.getAttribute("data-uid") ||
        writer.querySelector("[data-user-id]")?.getAttribute("data-user-id") ||
        undefined,
      ip: writer.getAttribute("data-ip") ||
        identityRoot?.getAttribute("data-ip") ||
        writer.querySelector("[data-ip]")?.getAttribute("data-ip") ||
        undefined,
      raw: textOf(nameRoot)
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

  function commentIdentityText(commentNode) {
    const identity = getAuthorFromElement(commentNode) || {};
    const pieces = [
      identity.name ? `author:${identity.name}` : "",
      identity.uid ? `uid:${identity.uid}` : "",
      identity.ip ? `ip:${identity.ip}` : ""
    ].filter(Boolean);
    return pieces.join(" ");
  }

  function getBodyRoot() {
    return first(".write_div") ||
      first(".writing_view_box") ||
      first(".view_content_wrap article") ||
      first("article");
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
    const candidates = [
      document.title,
      ...textOf(document.body).split(/\n| {2,}/u).slice(0, 30),
      ...visibleTextElements().map((element) => textOf(element)),
      ...all("input, textarea").map((element) => normalize(
        element.value ||
        element.getAttribute("placeholder") ||
        element.getAttribute("title") ||
        element.getAttribute("aria-label")
      ))
    ];
    for (const candidate of candidates) {
      const match = normalize(candidate).match(/([A-Za-z][A-Za-z0-9_-]{2,})\s*메모/u);
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

  function imageSourceCandidate(image) {
    const rawSource = normalize(
      image.getAttribute("src") ||
      image.getAttribute("data-src") ||
      image.getAttribute("data-original") ||
      image.getAttribute("data-lazy-src") ||
      image.getAttribute("srcset")
    );
    if (!rawSource && !image.currentSrc) return "";
    const resolved = image.currentSrc || image.src;
    if (!resolved) return "";
    try {
      const resolvedUrl = new URL(resolved, location.href);
      if (resolvedUrl.href === location.href) return "";
      if (/^https?:$/iu.test(resolvedUrl.protocol) && /(^|\.)gall\.dcinside\.com$/iu.test(resolvedUrl.hostname) && /\/board\/view\//iu.test(resolvedUrl.pathname)) {
        return "";
      }
      return resolvedUrl.href;
    } catch {
      return "";
    }
  }

  function isImageLikeFilename(value) {
    try {
      const url = new URL(value, location.href);
      const fno = url.searchParams.get("f_no") || "";
      return /\.(png|jpe?g|gif|webp|bmp|avif)$/iu.test(decodeURIComponent(fno || url.pathname));
    } catch {
      return /\.(png|jpe?g|gif|webp|bmp|avif)$/iu.test(value);
    }
  }

  function getAttachmentImages() {
    return all(".appending_file_box .appending_file a[href], .appending_file a[href]")
      .map((link) => {
        const href = link.href;
        const label = textOf(link) || link.getAttribute("download") || href;
        return {
          src: href,
          alt: label,
          nearbyText: normalize(`${textOf(link.closest(".appending_file_box")) || "원본 첨부파일"} ${label}`)
        };
      })
      .filter((image) => image.src && isImageLikeFilename(image.alt || image.src));
  }

  function uniqueImages(images) {
    const seen = new Set();
    return images.filter((image) => {
      if (!image.src || seen.has(image.src)) return false;
      seen.add(image.src);
      return true;
    });
  }

  function getImages(bodyRoot) {
    const bodyImages = bodyRoot ? all("img", bodyRoot)
      .filter((image) => !isLikelyAdImage(image))
      .map((image) => ({
        src: imageSourceCandidate(image),
        alt: image.alt || image.getAttribute("title") || "",
        nearbyText: normalize(image.closest("p, div, figure, article, section")?.textContent || "")
      }))
      .filter((image) => image.src) : [];
    return uniqueImages([...bodyImages, ...getAttachmentImages()]);
  }

  function mediaSourceCandidate(media) {
    const rawSource = normalize(
      media.getAttribute("data-src") ||
      media.getAttribute("src") ||
      media.currentSrc ||
      media.src ||
      media.querySelector?.("source")?.getAttribute("src") ||
      media.querySelector?.("source")?.src ||
      ""
    );
    if (!rawSource) return "";
    try {
      const resolved = new URL(rawSource, location.href);
      if (resolved.href === location.href) return "";
      return resolved.href;
    } catch {
      return rawSource;
    }
  }

  function isLikelyCommentEmoticonMedia(media) {
    if (!media) return false;
    if (media.tagName === "IMG" && isLikelyAdImage(media)) return false;
    if (media.closest(".gall_writer, .ub-writer, .writer_nikcon, .nickname, .user_info, .profile, .avatar")) {
      return false;
    }
    if (media.classList.contains("written_dccon") || media.closest(".comment_dccon")) {
      return Boolean(mediaSourceCandidate(media));
    }
    return media.tagName === "IMG" && Boolean(imageSourceCandidate(media));
  }

  function decodedFilenameFromUrl(value) {
    try {
      const url = new URL(value, location.href);
      return normalize(decodeURIComponent(url.searchParams.get("f_no") || url.searchParams.get("name") || url.pathname.split("/").pop() || ""));
    } catch {
      return normalize(value.split(/[\\/]/u).pop() || "");
    }
  }

  function dcconCodeFromUrl(value) {
    const source = normalize(value);
    if (!source) return "";
    try {
      const url = new URL(source, location.href);
      return normalize(url.searchParams.get("no") || "");
    } catch {
      const match = source.match(/[?&]no=([^&#]+)/u);
      return normalize(match?.[1] ? decodeURIComponent(match[1]) : "");
    }
  }

  function cleanEmoticonNameCandidate(value) {
    const normalized = normalize(value)
      .replace(/^["']|["']$/gu, "")
      .replace(/\.(png|jpe?g|gif|webp|bmp|avif)$/iu, "")
      .trim();
    if (!normalized) return "";
    if (/^[0-9]+$/u.test(normalized)) return "";
    if (/^(img|image|icon|dccon|dccon\.php|con|emoji|emoticon|sticker|file|download|viewimage|comment emoticon \d+)$/iu.test(normalized)) return "";
    if (/^https?:\/\//iu.test(normalized)) return "";
    return normalized.slice(0, 80);
  }

  function rawEmoticonTitle(media) {
    return normalize(
      media.getAttribute("conalt") ||
      media.getAttribute("alt") ||
      media.getAttribute("title") ||
      media.getAttribute("aria-label") ||
      ""
    ).slice(0, 80);
  }

  function emoticonNameCandidates(media) {
    const values = [
      media.getAttribute("conalt"),
      media.getAttribute("alt"),
      media.getAttribute("title"),
      media.getAttribute("aria-label"),
      media.getAttribute("data-name"),
      media.getAttribute("data-title"),
      media.getAttribute("data-original-title"),
      decodedFilenameFromUrl(mediaSourceCandidate(media))
    ];
    return Array.from(new Set(values.map(cleanEmoticonNameCandidate).filter(Boolean)));
  }

  function getCookie(name) {
    const key = `${name}=`;
    return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(key))?.slice(key.length) || "";
  }

  async function fetchDcconPackageDetail(code) {
    if (!code || !/^https?:$/u.test(location.protocol)) return undefined;
    const body = new window.URLSearchParams({
      ci_t: getCookie("ci_c"),
      package_idx: "",
      code
    });
    const response = await fetch(new URL("/dccon/package_detail", location.origin).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      credentials: "same-origin",
      body
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (!text || text === "error") return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  function detectionWithPackageDetail(detection, packageDetail) {
    const packageName = cleanEmoticonNameCandidate(packageDetail?.info?.title);
    if (!packageName) return detection;
    const names = Array.from(new Set([
      packageName,
      ...(detection.names || [])
    ].map(cleanEmoticonNameCandidate).filter(Boolean)));
    return {
      ...detection,
      names,
      primaryName: packageName,
      packageName,
      packageIdx: normalize(packageDetail?.info?.package_idx || ""),
      nearbyText: normalize(`${detection.nearbyText || ""} package:${packageName}`).slice(0, 700)
    };
  }

  async function resolveCommentEmoticonPackageDetails(observation) {
    const detections = observation?.metadata?.commentEmoticonDetections;
    if (!Array.isArray(detections) || detections.length === 0) return observation;
    const cache = new Map();
    const resolved = await Promise.all(detections.map(async (detection) => {
      if (!detection.dcconCode) return detection;
      if (!cache.has(detection.dcconCode)) {
        cache.set(detection.dcconCode, fetchDcconPackageDetail(detection.dcconCode).catch(() => undefined));
      }
      const packageDetail = await cache.get(detection.dcconCode);
      return detectionWithPackageDetail(detection, packageDetail);
    }));
    return {
      ...observation,
      metadata: {
        ...observation.metadata,
        commentEmoticonDetections: resolved
      }
    };
  }

  function getCommentEmoticonDetections() {
    const results = [];
    getCommentNodes().forEach((node, commentIndex) => {
      const textRoot = first(".usertxt, .comment_content, .txt, p", node) || node;
      const commentText = textOf(textRoot) || textOf(node);
      const identity = commentIdentityText(node);
      all("img, video.written_dccon, .written_dccon", textRoot)
        .filter(isLikelyCommentEmoticonMedia)
        .forEach((media, imageIndex) => {
          const source = mediaSourceCandidate(media);
          const names = emoticonNameCandidates(media);
          const fallbackName = `comment-emoticon-${commentIndex + 1}-${imageIndex + 1}`;
          const iconTitle = rawEmoticonTitle(media);
          const dcconCode = dcconCodeFromUrl(source);
          results.push({
            names,
            primaryName: names[0] || fallbackName,
            iconTitle,
            dcconCode,
            packageName: "",
            packageIdx: "",
            sourceHint: cleanEmoticonNameCandidate(decodedFilenameFromUrl(source)),
            nearbyText: normalize([
              `comment[${commentIndex + 1}]`,
              identity,
              commentText,
              names.length ? `emoticon:${names.join(" / ")}` : "",
              iconTitle && !names.includes(iconTitle) ? `icon-title:${iconTitle}` : ""
            ].filter(Boolean).join(" ")).slice(0, 700)
          });
        });
    });
    return results;
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

  function urlPostNo(url) {
    try {
      return new URL(url, location.href).searchParams.get("no") || undefined;
    } catch {
      return undefined;
    }
  }

  function absoluteUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  }

  function hasAttachedImageMarker(row, titleCell) {
    const root = titleCell || row;
    const candidates = all([
      ".icon_pic",
      ".icon_img",
      ".ico_pic",
      ".ico_img",
      ".list_icon_pic",
      ".list_icon_img",
      "[class*='icon_pic']",
      "[class*='icon_img']",
      "[class*='ico_pic']",
      "[class*='ico_img']",
      "img"
    ].join(","), root);

    return candidates.some((element) => {
      const haystack = normalize([
        element.className,
        element.id,
        element.getAttribute("src"),
        element.getAttribute("alt"),
        element.getAttribute("title"),
        element.getAttribute("aria-label"),
        textOf(element)
      ].filter(Boolean).join(" ")).toLowerCase();
      if (!haystack) return false;
      return /(^|[\s_.-])(pic|photo|image|img|attach|file)([\s_.-]|$)/iu.test(haystack) ||
        /첨부|이미지|사진/u.test(haystack);
    });
  }

  function listPostFromLink(link, options = {}) {
    if (!(link instanceof HTMLElement)) return undefined;
    const title = textOf(link) || normalize(link.getAttribute("title")) || normalize(link.getAttribute("aria-label"));
    const url = absoluteUrl(link.getAttribute("href") || "");
    if (!title || !url || !/\/board\/view\//iu.test(url)) return undefined;
    if (/^\[[0-9]+\]$/u.test(normalize(title))) return undefined;

    const row = link.closest("tr, li, .ub-content") || link.closest(".gall_tit") || link.parentElement;
    const rowElement = row instanceof HTMLElement ? row : undefined;
    const visible = rowElement ? isVisible(rowElement) && inViewport(rowElement) : isVisible(link) && inViewport(link);
    if (options.visibleOnly && !visible) return undefined;

    const titleCell = link.closest(".gall_tit, .ub-word") || link.parentElement || link;
    const subject = rowElement ? textOf(first(".gall_subject", rowElement)) || textOf(rowElement.querySelector("td")) : "";
    const writer = rowElement
      ? getAuthorFromElement(first(".gall_writer, .ub-writer, [data-uid], [data-user-id], [data-ip]", rowElement) || rowElement)
      : undefined;

    return {
      title,
      url,
      postNo: urlPostNo(url),
      head: subject || undefined,
      author: writer?.name ? writer : undefined,
      hasImage: hasAttachedImageMarker(rowElement || link, titleCell),
      visible,
      source: visible ? "visible-row" : "html-link"
    };
  }

  function uniqueListPosts(posts) {
    const seen = new Set();
    return posts.filter((post) => {
      if (!post?.url) return false;
      const key = post.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function collectVisibleListPosts() {
    const rows = all(".gall_list tbody tr.ub-content, .gall_list tbody tr, tr.ub-content");
    const rowPosts = rows.map((row) => {
      if (!(row instanceof HTMLElement) || !isVisible(row) || !inViewport(row)) return undefined;
      const titleCell = first(".gall_tit, .ub-word, td:nth-child(2)", row) || row;
      const link = first("a[href*='/board/view/'], a[href*='board/view']", titleCell);
      return listPostFromLink(link, { visibleOnly: true });
    }).filter(Boolean);
    const htmlPosts = all(".gall_list a[href*='/board/view/'], a[href*='/board/view/']")
      .map((link) => listPostFromLink(link))
      .filter(Boolean);
    const posts = uniqueListPosts([...rowPosts, ...htmlPosts]);

    return {
      ok: true,
      url: location.href,
      galleryId: getUrlParam("id"),
      visibleCount: posts.filter((post) => post.visible).length,
      posts
    };
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
        documentTitle: document.title,
        commentEmoticonDetections: getCommentEmoticonDetections()
      }
    };
  }

  async function collectObservationAsync() {
    return resolveCommentEmoticonPackageDetails(collectObservation());
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
        collectObservationAsync().then((observation) => {
          sendResponse({ ok: true, observation });
        }).catch((error) => {
          sendResponse({ ok: false, reason: String(error?.message || error), observation: collectObservation() });
        });
        return true;
      }
      if (message?.type === "MAVEN_COLLECT_VISIBLE_LIST_POSTS") {
        sendResponse(collectVisibleListPosts());
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
  window.__dcMavenCollectObservationForTestAsync = collectObservationAsync;
  window.__dcMavenCollectVisibleListPostsForTest = collectVisibleListPosts;
  window.__dcMavenResolveCommentUidsForTest = resolveCommentUids;
  window.__dcMavenSafeActionForTest = safeAction;
})();
