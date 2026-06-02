(function () {
  "use strict";

  const state = {
    observation: null,
    screenshotDataUrl: null,
    card: null,
    auditId: null,
    contextMessages: []
  };

  const DEFAULT_JUDGE_MODELS = [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.2"
  ];
  const MODEL_LABELS = {
    "gpt-5.5": "GPT-5.5",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.4-mini": "GPT-5.4-Mini",
    "gpt-5.3-codex": "GPT-5.3-Codex",
    "gpt-5.3-codex-spark": "GPT-5.3-Codex-Spark",
    "gpt-5.2": "GPT-5.2"
  };

  const backendUrlInput = document.querySelector("#backendUrl");
  const modelSelect = document.querySelector("#modelSelect");
  const judgeButton = document.querySelector("#judgeButton");
  const commentJudgeButton = document.querySelector("#commentJudgeButton");
  const imageJudgeButton = document.querySelector("#imageJudgeButton");
  const startProxyButton = document.querySelector("#startProxyButton");
  const authStatus = document.querySelector("#authStatus");
  const oauthPanel = document.querySelector("#oauthPanel");
  const oauthProxyStatus = document.querySelector("#oauthProxyStatus");
  const summaryPanel = document.querySelector("#summaryPanel");
  const memberPanel = document.querySelector("#memberPanel");
  const cardPanel = document.querySelector("#cardPanel");
  const actionsPanel = document.querySelector("#actionsPanel");
  const errorPanel = document.querySelector("#errorPanel");
  const listImageBriefForm = document.querySelector("#listImageBriefForm");
  const listImageBriefToggle = document.querySelector("#listImageBriefToggle");
  const listImageBriefBody = document.querySelector("#listImageBriefBody");
  const listImageTitleInput = document.querySelector("#listImageTitleInput");
  const listImageBriefButton = document.querySelector("#listImageBriefButton");
  const listImageBriefResult = document.querySelector("#listImageBriefResult");
  const contextQuestionForm = document.querySelector("#contextQuestionForm");
  const contextQuestionInput = document.querySelector("#contextQuestionInput");
  const contextAskButton = document.querySelector("#contextAskButton");
  const contextChatMessages = document.querySelector("#contextChatMessages");

  backendUrlInput.value = localStorage.getItem("mavenBackendUrl") || backendUrlInput.value;

  function normalizeModels(models) {
    if (!Array.isArray(models)) return DEFAULT_JUDGE_MODELS;
    const valid = models.filter((model) => DEFAULT_JUDGE_MODELS.includes(model));
    return valid.length ? valid : DEFAULT_JUDGE_MODELS;
  }

  function selectedModel() {
    return modelSelect.value || DEFAULT_JUDGE_MODELS[0];
  }

  function populateModelSelect(models, preferredModel) {
    const allowed = normalizeModels(models);
    const selected = allowed.includes(preferredModel) ? preferredModel : allowed[0];
    modelSelect.innerHTML = "";
    for (const model of allowed) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = MODEL_LABELS[model] || model;
      modelSelect.appendChild(option);
    }
    modelSelect.value = selected;
  }

  populateModelSelect(DEFAULT_JUDGE_MODELS, localStorage.getItem("mavenJudgeModel") || DEFAULT_JUDGE_MODELS[0]);

  function backendUrl(path) {
    return `${backendUrlInput.value.replace(/\/+$/, "")}${path}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function setError(message) {
    errorPanel.hidden = !message;
    errorPanel.textContent = message || "";
  }

  function showOAuthPanel(status) {
    const needsAttention = !status?.configured || !status?.proxyReady;
    oauthPanel.hidden = !needsAttention;
    const base = status?.baseUrl || `http://127.0.0.1:${status?.oauthPort || 10531}`;
    const proxyCommand = status?.proxyCommand || `npx -y openai-oauth --port ${status?.oauthPort || 10531}`;
    const loginCommand = status?.loginCommand || "npx @openai/codex login";
    oauthProxyStatus.textContent = `proxy: ${base} | autoStart: ${status?.autoStart === false ? "off" : "on"} | manual login if needed: ${loginCommand} | proxy command: ${proxyCommand}`;
  }

  function backendFetchError(error) {
    const message = String(error?.message || error);
    if (/failed to fetch|load failed|networkerror|fetch/i.test(message)) {
      return `Backend connection failed: ${backendUrlInput.value} is not reachable. The extension will try native auto-start; if that fails, run npm run install:native-host once from C:\\Users\\hub2v\\Desktop\\Sing2.`;
    }
    return message;
  }

  function isBackendNetworkError(error) {
    return /Backend connection failed|failed to fetch|load failed|networkerror|fetch/i.test(String(error?.message || error));
  }

  async function sendMessage(message) {
    if (window.__DC_MAVEN_TEST__?.sendMessage) {
      return window.__DC_MAVEN_TEST__.sendMessage(message);
    }
    return chrome.runtime.sendMessage(message);
  }

  function staleBackendMessage() {
    return `stale backend: ${backendUrlInput.value} is an older Maven backend. Stop the old process on this port, then restart it with npm run dev:backend or reload the extension native host.`;
  }

  async function ensureBackendCompatible(extraRequiredFeatures = []) {
    let capabilities;
    try {
      capabilities = await fetchJson("/api/capabilities");
    } catch (error) {
      const message = String(error?.message || error);
      if (/404|not found|Cannot GET|Cannot POST/i.test(message)) {
        throw new Error(staleBackendMessage());
      }
      throw error;
    }

    const features = Array.isArray(capabilities?.features) ? capabilities.features : [];
    const required = ["members.observe", "openai-oauth-proxy", "judge.model-select", ...extraRequiredFeatures];
    const missing = required.filter((feature) => !features.includes(feature));
    if (missing.length) {
      throw new Error(`${staleBackendMessage()} Missing features: ${missing.join(", ")}`);
    }
    return capabilities;
  }

  async function ensureBackendRunning() {
    authStatus.textContent = "backend auto-starting";
    const response = await sendMessage({ type: "MAVEN_ENSURE_BACKEND", backendUrl: backendUrlInput.value });
    if (!response?.ok) {
      throw new Error(`Backend auto-start failed: ${response?.reason || "native host did not respond"}. Run npm run install:native-host once.`);
    }
    authStatus.textContent = response.started ? "backend auto-started" : "backend running";
    return response;
  }

  async function fetchJson(path, options, allowAutoStart = true) {
    let response;
    try {
      response = await fetch(backendUrl(path), options);
    } catch (error) {
      const wrapped = new Error(backendFetchError(error));
      if (!allowAutoStart || !isBackendNetworkError(wrapped)) {
        throw wrapped;
      }
      await ensureBackendRunning();
      return fetchJson(path, options, false);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Backend request failed: ${response.status}`);
    }
    return response.json();
  }

  async function refreshStatus() {
    try {
      const status = await fetchJson("/api/auth/openai/status");
      const models = normalizeModels(status.allowedModels);
      const storedModel = localStorage.getItem("mavenJudgeModel");
      const preferredModel = storedModel && models.includes(storedModel) ? storedModel : status.model;
      populateModelSelect(models, preferredModel);
      authStatus.textContent = `${status.mode} · ${status.model}${status.proxyReady ? " · proxy ready" : " · login/proxy needed"}`;
      authStatus.textContent = `${status.mode} 쨌 ${selectedModel()}${status.proxyReady ? " 쨌 proxy ready" : " 쨌 login/proxy needed"}`;
      showOAuthPanel(status);
      authStatus.textContent = `${status.mode} | ${selectedModel()}${status.proxyReady ? " | proxy ready" : " | login/proxy needed"}`;
    } catch {
      authStatus.textContent = "backend connection needed";
      populateModelSelect(DEFAULT_JUDGE_MODELS, localStorage.getItem("mavenJudgeModel") || selectedModel());
      showOAuthPanel({ configured: false, proxyReady: false, autoStart: true, oauthPort: 10531 });
    }
  }

  async function ensureOpenAIOAuthProxy() {
    setError("");
    startProxyButton.disabled = true;
    try {
      const result = await sendMessage({ type: "MAVEN_ENSURE_OPENAI_OAUTH_PROXY" });
      if (!result?.ok) {
        throw new Error(result?.reason || "openai-oauth proxy could not be started");
      }
      authStatus.textContent = `${result.proxyReady ? "proxy ready" : "proxy starting"} | ${result.proxyCommand || "npx -y openai-oauth --port 10531"}`;
      await refreshStatus();
      if (result.proxyReady) {
        oauthPanel.hidden = true;
        authStatus.textContent = `openai-oauth-proxy | ${selectedModel()} | proxy ready`;
      }
    } catch (error) {
      setError(String(error?.message || error));
    } finally {
      startProxyButton.disabled = false;
    }
  }

  function renderSummary(observation) {
    summaryPanel.innerHTML = `
      <h2 class="section-title">Current page summary</h2>
      <div class="meta">
        <div><strong>${escapeHtml(observation.title)}</strong></div>
        <div>${escapeHtml(observation.galleryId || "-")} · ${escapeHtml(observation.postNo || "-")} · ${escapeHtml(observation.head || "-")}</div>
        <div>${escapeHtml(observation.author?.name || "-")} · ${escapeHtml(observation.createdAtText || "-")}</div>
        <div>body ${escapeHtml(String(observation.bodyText?.length || 0))} chars · comments ${escapeHtml(String(observation.comments?.length || 0))} · images ${escapeHtml(String(observation.images?.length || 0))}</div>
      </div>
    `;
  }

  function riskOptions(current) {
    return ["low", "watch", "high"].map((level) => (
      `<option value="${level}"${level === current ? " selected" : ""}>${level}</option>`
    )).join("");
  }

  function renderMembers(profiles = []) {
    if (!profiles.length) {
      memberPanel.innerHTML = "";
      return;
    }
    memberPanel.innerHTML = `
      <h2 class="section-title">Local member risk</h2>
      ${profiles.map((profile) => `
        <div class="member-row">
          <div class="member-main">
            <strong>${escapeHtml((profile.aliases || [])[0] || profile.key)}</strong>
            <div class="meta">${escapeHtml(profile.key)}</div>
            <div class="meta">uid ${escapeHtml((profile.uids || []).join(", ") || "-")} | ip ${escapeHtml((profile.ips || []).join(", ") || "-")} | seen ${escapeHtml(profile.observationCount || 0)}</div>
          </div>
          <select data-member-risk-key="${escapeHtml(profile.key)}" aria-label="Member risk for ${escapeHtml(profile.key)}">
            ${riskOptions(profile.riskLevel || "low")}
          </select>
        </div>
      `).join("")}
    `;
    for (const select of memberPanel.querySelectorAll("[data-member-risk-key]")) {
      select.addEventListener("change", () => updateMemberRisk(select.dataset.memberRiskKey, select.value));
    }
  }

  async function refreshMembers(observation) {
    const result = await fetchJson("/api/members/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation })
    });
    renderMembers(result.profiles || []);
  }

  async function updateMemberRisk(key, riskLevel) {
    if (!key) return;
    await fetchJson("/api/members/risk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, riskLevel })
    });
    authStatus.textContent = `member risk saved | ${riskLevel}`;
  }

  function renderRules(rules = []) {
    return rules.map((rule) => `
      <div class="rule">
        <strong>${escapeHtml(rule.rule_id)}</strong>
        <div>source_post_no: <strong>${escapeHtml(rule.source_post_no)}</strong> · relevance ${escapeHtml(rule.relevance)}</div>
        <div class="quote">${escapeHtml(rule.excerpt)}</div>
      </div>
    `).join("");
  }

  function renderEvidence(card) {
    const current = (card.current_page_evidence || []).map((item) => `
      <div class="quote"><strong>${escapeHtml(item.location)}</strong><br />${escapeHtml(item.quote)}</div>
    `).join("");
    const policy = (card.policy_evidence || []).map((item) => `
      <div class="quote"><strong>${escapeHtml(item.source_post_no)}</strong> · ${escapeHtml(item.rule_id)}<br />${escapeHtml(item.quote)}</div>
    `).join("");
    return `
      <div class="evidence-grid">
        <div class="evidence-box">
          <h3 class="section-title">Current page evidence</h3>
          ${current || "<p>-</p>"}
        </div>
        <div class="evidence-box">
          <h3 class="section-title">Policy evidence</h3>
          ${policy || "<p>-</p>"}
        </div>
      </div>
    `;
  }

  function formatCliqueSignal(signal) {
    if (!signal || typeof signal !== "object") return "";
    const indices = Array.isArray(signal.comment_indices) ? signal.comment_indices.join(", ") : "-";
    const users = Array.isArray(signal.user_keys) ? signal.user_keys.join(", ") : "-";
    return `${signal.signal_type || "-"} / ${signal.severity || "-"} / comments: ${indices} / users: ${users}\n${signal.rationale || ""}`;
  }

  function formatCliqueEvidenceQuote(item) {
    if (typeof item === "string") return `"${item}"`;
    if (!item || typeof item !== "object") return "";
    const user = item.speaker_user_key || item.target_user_key || "-";
    return `#${item.comment_index || "-"} ${item.signal_type || "-"} / ${item.severity || "-"} / ${user}: "${item.quote || ""}" - ${item.why_it_matters || ""}`;
  }

  function renderCliqueAssessment(assessment) {
    const signals = Array.isArray(assessment.clique_signals)
      ? assessment.clique_signals.map(formatCliqueSignal).filter(Boolean)
      : [];
    const guardrails = Array.isArray(assessment.clique_fp_guardrails_applied)
      ? assessment.clique_fp_guardrails_applied
      : [];
    const hasCliqueAssessment = Boolean(
      assessment.clique_likelihood ||
      assessment.clique_summary ||
      assessment.nickname_mention_policy_risk ||
      signals.length ||
      guardrails.length
    );
    if (!hasCliqueAssessment) return "";
    const confidence = typeof assessment.clique_confidence === "number"
      ? ` | confidence: ${Math.round(assessment.clique_confidence * 100)}%`
      : "";
    const humanReview = typeof assessment.clique_requires_human_review === "boolean"
      ? ` | human review: ${assessment.clique_requires_human_review ? "yes" : "no"}`
      : "";
    return `
      <h3 class="section-title">친목/네임드화</h3>
      <div class="quote">
        <strong>${escapeHtml(assessment.clique_likelihood || "-")}</strong>
        | 닉언 정책 리스크: ${escapeHtml(assessment.nickname_mention_policy_risk || "-")}${escapeHtml(confidence)}${escapeHtml(humanReview)}<br />
        ${escapeHtml(assessment.clique_summary || "-")}
      </div>
      ${signals.length ? `<div class="quote"><strong>signals</strong><br />${escapeHtml(signals.join("\n"))}</div>` : ""}
      ${guardrails.length ? `<div class="quote"><strong>false-positive guardrails</strong><br />${escapeHtml(guardrails.join("\n"))}</div>` : ""}
    `;
  }

  function renderCommentThreadAssessment(card) {
    const assessment = card.comment_thread_assessment;
    if (!assessment || typeof assessment !== "object") return "";
    const users = Array.isArray(assessment.per_user) ? assessment.per_user : [];
    const perUser = users.map((user) => {
      const identity = [
        user.display_name || user.user_key || "-",
        user.uid ? `uid:${user.uid}` : "",
        user.ip ? `ip:${user.ip}` : ""
      ].filter(Boolean).join(" | ");
      const indices = Array.isArray(user.comment_indices) ? user.comment_indices.join(", ") : "-";
      const quotes = Array.isArray(user.evidence_quotes) ? user.evidence_quotes.map((quote) => `"${quote}"`).join("\n") : "-";
      const cliqueEvidence = Array.isArray(user.clique_evidence_quotes)
        ? user.clique_evidence_quotes.map(formatCliqueEvidenceQuote).filter(Boolean)
        : [];
      const cliqueExemptions = Array.isArray(user.clique_fp_exemptions) ? user.clique_fp_exemptions : [];
      const hasUserClique = Boolean(
        user.clique_role ||
        user.clique_risk_level ||
        user.clique_rationale ||
        cliqueEvidence.length ||
        cliqueExemptions.length
      );
      const userCliqueBlock = hasUserClique
        ? `<br />
          clique: ${escapeHtml(user.clique_role || "-")} / ${escapeHtml(user.clique_risk_level || "-")}<br />
          ${escapeHtml(user.clique_rationale || "-")}<br />
          clique evidence: ${escapeHtml(cliqueEvidence.join("\n") || "-")}<br />
          clique fp exemptions: ${escapeHtml(cliqueExemptions.join("\n") || "-")}`
        : "";
      return `
        <div class="quote">
          <strong>${escapeHtml(identity)}</strong> / ${escapeHtml(user.role || "-")} / ${escapeHtml(user.risk_level || "-")}<br />
          comments: ${escapeHtml(indices)}<br />
          ${escapeHtml(user.rationale || "-")}<br />
          evidence: ${escapeHtml(quotes)}${userCliqueBlock}
        </div>
      `;
    }).join("");
    return `
      <h3 class="section-title">댓글 싸움 여부</h3>
      <div class="quote">
        <strong>${escapeHtml(assessment.fighting_likelihood || "-")}</strong><br />
        ${escapeHtml(assessment.fighting_summary || "-")}
      </div>
      ${renderCliqueAssessment(assessment)}
      <h3 class="section-title">댓글러별 판단</h3>
      ${perUser || "<p>-</p>"}
    `;
  }

  function renderCard(card) {
    cardPanel.innerHTML = `
      <h2 class="section-title">${escapeHtml(card.summary)}</h2>
      <div class="chips">${(card.issue_types || []).map((type) => `<span class="chip">${escapeHtml(type)}</span>`).join("")}</div>
      <p><strong>LLM reasoning</strong><br />${escapeHtml(card.llm_reasoning)}</p>
      <p><strong>uncertainty</strong>: ${escapeHtml(card.uncertainty)}</p>
      <p><strong>false_positive_risk</strong>: ${escapeHtml(card.false_positive_risk)}</p>
      <p><strong>final_human_decision_required: true</strong></p>
      ${renderCommentThreadAssessment(card)}
      ${renderEvidence(card)}
      <h3 class="section-title">matched rules</h3>
      ${renderRules(card.matched_rules)}
      <h3 class="section-title">recommended actions</h3>
      ${(card.recommended_actions || []).map((action) => `<div class="quote"><strong>${escapeHtml(action.type)}</strong> · ${escapeHtml(action.label)}<br />${escapeHtml(action.rationale)}</div>`).join("")}
    `;
  }

  function renderContextMessages() {
    contextChatMessages.innerHTML = state.contextMessages.map((message) => `
      <div class="context-message ${escapeHtml(message.role)}">
        <strong>${message.role === "user" ? "질문" : "답변"}</strong><br />
        ${escapeHtml(message.content)}
      </div>
    `).join("");
    contextChatMessages.scrollTop = contextChatMessages.scrollHeight;
  }

  function reasonText() {
    if (!state.card) return "";
    return [
      state.card.summary,
      state.card.llm_reasoning,
      "Current page evidence:",
      ...(state.card.current_page_evidence || []).map((item) => `- ${item.location}: ${item.quote}`),
      "Policy evidence:",
      ...(state.card.policy_evidence || []).map((item) => `- ${item.source_post_no}/${item.rule_id}: ${item.quote}`),
      "final_human_decision_required: true"
    ].join("\n");
  }

  function noticeDraft() {
    return `Moderation review candidate\n\n${reasonText()}\n\nFinal decision and browser click must be performed by the human.`;
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
  }

  function managerUrl() {
    const galleryId = state.observation?.galleryId || "thesingularity";
    return `https://gall.dcinside.com/mgallery/management/?id=${encodeURIComponent(galleryId)}`;
  }

  function renderActions() {
    actionsPanel.innerHTML = "";
    const buttons = [
      ["Copy post URL", () => copyText(state.observation?.url || "")],
      ["Show comments", () => sendMessage({ type: "MAVEN_SAFE_ACTION", action: { kind: "scroll", selector: "#comments, .comment_box, .cmt_list", label: "show comments" } })],
      ["Save evidence screenshot", () => sendMessage({ type: "MAVEN_SAVE_SCREENSHOT", screenshotDataUrl: state.screenshotDataUrl, filename: `dcinside-${state.observation?.postNo || "page"}-evidence.png` })],
      ["Copy reason", () => copyText(reasonText())],
      ["Copy notice draft", () => copyText(noticeDraft())],
      ["Copy bot command", () => copyText((state.card?.special_bot_command_candidates || []).join("\n"))],
      ["Open management tab", () => sendMessage({ type: "MAVEN_OPEN_TAB", url: managerUrl(), label: "open management tab" })],
      ["Prefill reason", () => sendMessage({ type: "MAVEN_SAFE_ACTION", action: { kind: "prefill", selector: "textarea[name='reason'], textarea, input[type='text']", label: "reason input", value: reasonText() } })]
    ];
    const decisionButtons = [
      ["Log hold", "hold"],
      ["Log false positive", "false-positive"],
      ["Log delete candidate", "delete-candidate"],
      ["Log ban candidate", "ban-candidate"]
    ];
    for (const [label, handler] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => Promise.resolve(handler()).catch((error) => setError(String(error?.message || error))));
      actionsPanel.appendChild(button);
    }
    for (const [label, outcome] of decisionButtons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => recordDecision(outcome).catch((error) => setError(String(error?.message || error))));
      actionsPanel.appendChild(button);
    }
  }

  async function recordDecision(outcome) {
    if (!state.auditId) throw new Error("auditId missing");
    await fetchJson("/api/audit/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auditId: state.auditId,
        decision: {
          outcome,
          note: "sidepanel human final choice log only; no moderation action performed",
          decidedAt: new Date().toISOString()
        }
      })
    });
    setError("");
    authStatus.textContent = `human decision logged: ${outcome}`;
  }

  function setJudgmentBusy(activeButton, busyText) {
    judgeButton.disabled = true;
    commentJudgeButton.disabled = true;
    imageJudgeButton.disabled = true;
    activeButton.textContent = busyText;
  }

  function clearJudgmentBusy() {
    judgeButton.disabled = false;
    commentJudgeButton.disabled = false;
    imageJudgeButton.disabled = false;
    judgeButton.textContent = "이 페이지 LLM 판단";
    commentJudgeButton.textContent = "댓글 LLM 판단";
    imageJudgeButton.textContent = "이미지 LLM 판단";
  }

  function setContextBusy(isBusy) {
    contextAskButton.disabled = isBusy;
    contextQuestionInput.disabled = isBusy;
    contextAskButton.textContent = isBusy ? "질문 중" : "질문";
  }

  function setListImageBriefBusy(isBusy) {
    listImageBriefButton.disabled = isBusy;
    listImageTitleInput.disabled = isBusy;
    judgeButton.disabled = isBusy;
    commentJudgeButton.disabled = isBusy;
    imageJudgeButton.disabled = isBusy;
    listImageBriefButton.textContent = isBusy ? "브리핑 중" : "브리핑";
  }

  function setListImageBriefCollapsed(collapsed) {
    listImageBriefBody.hidden = collapsed;
    listImageBriefToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    listImageBriefToggle.textContent = collapsed ? "펼치기" : "접기";
  }

  async function observeCurrentPage(extraRequiredFeatures = []) {
    await fetchJson("/health");
    await ensureBackendCompatible(extraRequiredFeatures);
    const observed = await sendMessage({ type: "MAVEN_OBSERVE_ACTIVE_TAB" });
    if (!observed?.ok) throw new Error(observed?.reason || "active tab observation failed");
    state.observation = observed.observation;
    state.screenshotDataUrl = observed.screenshotDataUrl;
    renderSummary(state.observation);
    await refreshMembers(state.observation);
    return state.observation;
  }

  function storeRuntimeSettings() {
    localStorage.setItem("mavenBackendUrl", backendUrlInput.value);
    localStorage.setItem("mavenJudgeModel", selectedModel());
  }

  function handleJudgeError(error) {
    if (String(error?.message || error).includes("openai-oauth")) {
      showOAuthPanel({ configured: false, proxyReady: false, autoStart: true, oauthPort: 10531 });
    }
    setError(String(error?.message || error));
  }

  function renderJudgmentResult(result) {
    state.card = result.card;
    state.auditId = result.auditId;
    renderCard(state.card);
    renderActions();
  }

  function pageOnlyObservation(observation) {
    return {
      ...observation,
      comments: [],
      htmlExcerpt: "",
      viewportText: observation.bodyText || "",
      clickableLabels: (observation.clickableLabels || []).filter((label) => !/댓글|comment/i.test(label)),
      metadata: {
        ...(observation.metadata || {}),
        mavenJudgmentScope: "page-without-comments"
      }
    };
  }

  function commentTextForPrompt(comments = []) {
    return comments.map((comment, index) => {
      const identity = comment.authorIdentity || {};
      const author = comment.author || identity.name || "-";
      const uid = identity.uid ? ` uid:${identity.uid}` : "";
      const ip = comment.authorIdentity?.ip ? ` ip:${comment.authorIdentity.ip}` : "";
      const date = comment.date ? ` ${comment.date}` : "";
      return `[${index + 1}] ${author}${uid}${ip}${date}: ${comment.text}`;
    }).join("\n");
  }

  function commentUserKey(comment) {
    const identity = comment.authorIdentity || {};
    const name = comment.author || identity.name || "";
    if (identity.uid) return `uid:${identity.uid}`;
    if (identity.ip && name) return `ip-name:${identity.ip}:${name}`;
    if (identity.ip) return `ip:${identity.ip}`;
    if (name) return `name:${name}`;
    return "name:unknown";
  }

  function commentAuthorGroups(comments = []) {
    const groups = new Map();
    comments.forEach((comment, index) => {
      const identity = comment.authorIdentity || {};
      const key = commentUserKey(comment);
      const current = groups.get(key) || {
        user_key: key,
        display_name: comment.author || identity.name || "",
        uid: identity.uid || "",
        ip: identity.ip || "",
        comment_indices: []
      };
      current.comment_indices.push(index + 1);
      groups.set(key, current);
    });
    return Array.from(groups.values());
  }

  function commentOnlyObservation(observation) {
    const comments = Array.isArray(observation.comments) ? observation.comments : [];
    const authorGroups = commentAuthorGroups(comments);
    const commentText = commentTextForPrompt(comments);
    const bodyText = [
      "COMMENT JUDGMENT MODE",
      "Assess fighting/escalation and each individual commenter.",
      "",
      "COMMENT AUTHOR GROUPS:",
      JSON.stringify(authorGroups),
      "",
      "COMMENTS:",
      commentText
    ].join("\n");
    return {
      ...observation,
      title: `${observation.title} - 댓글 판단`,
      bodyText,
      htmlExcerpt: "",
      images: [],
      links: [],
      selectedText: "",
      viewportText: bodyText,
      clickableLabels: [],
      comments,
      metadata: {
        ...(observation.metadata || {}),
        mavenJudgmentScope: "comments-only",
        commentAuthorGroups: authorGroups
      }
    };
  }

  function renderListImageBriefResult(result, observation, listPost) {
    const title = observation?.title || listPost?.title || "";
    const postNo = observation?.postNo || listPost?.postNo || "-";
    const imageCount = result.imageCount ?? observation?.images?.length ?? 0;
    listImageBriefResult.innerHTML = [
      `<strong>${escapeHtml(title)}</strong>`,
      `post: ${escapeHtml(postNo)} | images: ${escapeHtml(String(imageCount))}`,
      escapeHtml(result.answer || "(empty image brief)")
    ].join("\n");
  }

  async function inlineObservationImages(observation) {
    const images = Array.isArray(observation.images) ? observation.images : [];
    if (!images.length) return observation;
    const result = await sendMessage({ type: "MAVEN_INLINE_IMAGE_URLS", images, pageUrl: observation.url });
    if (!result?.ok || !Array.isArray(result.images) || result.images.length === 0) {
      const failures = (result?.failures || []).map((item) => `${item.src}: ${item.reason}`).join("; ");
      console.warn("Uploaded images will be loaded by the backend instead of the extension.", failures);
      return observation;
    }
    return {
      ...observation,
      images: result.images
    };
  }

  async function judgeCurrentPage() {
    setError("");
    storeRuntimeSettings();
    setJudgmentBusy(judgeButton, "판단 중");
    try {
      await observeCurrentPage();
      const pageObservation = pageOnlyObservation(state.observation);

      const result = await fetchJson("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation: pageObservation,
          model: selectedModel()
        })
      });
      renderJudgmentResult(result);
      await refreshStatus();
    } catch (error) {
      handleJudgeError(error);
    } finally {
      clearJudgmentBusy();
    }
  }

  async function judgeCurrentComments() {
    setError("");
    storeRuntimeSettings();
    setJudgmentBusy(commentJudgeButton, "댓글 판단 중");
    try {
      const observation = await observeCurrentPage();
      if (!Array.isArray(observation.comments) || observation.comments.length === 0) {
        throw new Error("이 페이지에서 판단할 댓글을 찾지 못했습니다.");
      }
      const result = await fetchJson("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation: commentOnlyObservation(observation),
          model: selectedModel()
        })
      });
      renderJudgmentResult(result);
      await refreshStatus();
    } catch (error) {
      handleJudgeError(error);
    } finally {
      clearJudgmentBusy();
    }
  }

  async function judgeCurrentImages() {
    setError("");
    storeRuntimeSettings();
    setJudgmentBusy(imageJudgeButton, "이미지 판단 중");
    try {
      const observation = await observeCurrentPage(["judge.uploaded-images"]);
      if (!Array.isArray(observation.images) || observation.images.length === 0) {
        throw new Error("이 게시글 본문에서 작성자 업로드 이미지를 찾지 못했습니다.");
      }
      const imageObservation = await inlineObservationImages(observation);

      const result = await fetchJson("/api/judge/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation: imageObservation,
          model: selectedModel()
        })
      });
      renderJudgmentResult(result);
      await refreshStatus();
    } catch (error) {
      handleJudgeError(error);
    } finally {
      clearJudgmentBusy();
    }
  }

  async function briefListPostImages(event) {
    event.preventDefault();
    const title = listImageTitleInput.value.trim();
    if (!title) {
      setError("목록에서 보이는 게시글 제목을 입력하세요.");
      return;
    }
    setError("");
    listImageBriefResult.textContent = "";
    storeRuntimeSettings();
    setListImageBriefBusy(true);
    try {
      await fetchJson("/health");
      await ensureBackendCompatible(["images.list-title-brief"]);
      const observed = await sendMessage({ type: "MAVEN_OBSERVE_LIST_POST_BY_TITLE", title });
      if (!observed?.ok) {
        throw new Error(observed?.reason || "list post image observation failed");
      }
      if (!observed.observation || !Array.isArray(observed.observation.images) || observed.observation.images.length === 0) {
        throw new Error("The matched post did not expose uploaded images.");
      }
      const imageObservation = await inlineObservationImages(observed.observation);
      const result = await fetchJson("/api/images/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation: imageObservation,
          model: selectedModel()
        })
      });
      state.observation = imageObservation;
      state.card = null;
      state.auditId = null;
      renderListImageBriefResult(result, imageObservation, observed.listPost);
      state.contextMessages.push({ role: "assistant", content: `목록 이미지 브리핑:\n${result.answer || ""}` });
      renderContextMessages();
      authStatus.textContent = `image brief | ${result.model || selectedModel()}`;
    } catch (error) {
      handleJudgeError(error);
    } finally {
      setListImageBriefBusy(false);
    }
  }

  async function askContextQuestion(event) {
    event.preventDefault();
    const question = contextQuestionInput.value.trim();
    if (!question) return;
    setError("");
    storeRuntimeSettings();
    setContextBusy(true);
    const history = state.contextMessages.slice(-8);
    state.contextMessages.push({ role: "user", content: question });
    renderContextMessages();
    contextQuestionInput.value = "";
    try {
      if (!state.observation) {
        await observeCurrentPage(["context.chat"]);
      } else {
        await fetchJson("/health");
        await ensureBackendCompatible(["context.chat"]);
      }
      const result = await fetchJson("/api/chat/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation: state.observation,
          card: state.card,
          auditId: state.auditId,
          question,
          history,
          model: selectedModel()
        })
      });
      state.contextMessages.push({ role: "assistant", content: result.answer || "(empty answer)" });
      renderContextMessages();
      authStatus.textContent = `context answer | ${result.model || selectedModel()}`;
    } catch (error) {
      const message = String(error?.message || error);
      state.contextMessages.push({ role: "assistant", content: `오류: ${message}` });
      renderContextMessages();
      handleJudgeError(error);
    } finally {
      setContextBusy(false);
    }
  }

  backendUrlInput.addEventListener("change", refreshStatus);
  modelSelect.addEventListener("change", () => {
    setTimeout(() => {
      authStatus.textContent = `selected model | ${selectedModel()}`;
    }, 0);
    localStorage.setItem("mavenJudgeModel", selectedModel());
    authStatus.textContent = `selected model 쨌 ${selectedModel()}`;
  });
  judgeButton.addEventListener("click", judgeCurrentPage);
  commentJudgeButton.addEventListener("click", judgeCurrentComments);
  imageJudgeButton.addEventListener("click", judgeCurrentImages);
  listImageBriefToggle.addEventListener("click", () => {
    setListImageBriefCollapsed(!listImageBriefBody.hidden);
  });
  listImageBriefForm.addEventListener("submit", briefListPostImages);
  contextQuestionForm.addEventListener("submit", askContextQuestion);
  startProxyButton.addEventListener("click", ensureOpenAIOAuthProxy);
  refreshStatus();
})();
