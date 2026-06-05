# DCInside Maven Copilot

Read-only Chrome Extension + local Fastify backend for LLM-first moderation review of DCInside `특이점이 온다` gallery pages.

The extension observes the page the human is already viewing, sends a redacted DOM/screenshot observation to the local backend, retrieves policy evidence from the local manager-post corpus, and asks an OpenAI-compatible LLM for a strict judgment card. It never clicks delete, ban, submit, post, comment, confirm, save, or apply.

## Architecture

- `extension/manifest.json`: Manifest V3 extension.
- `extension/content.js`: extracts DCInside URL, gallery id, post no, title, head, author/id/ip text, time, counts, visible body text, HTML excerpt, comments/replies, comment DCCon package names from metadata and `/dccon/package_detail`, post image URLs/alt/nearby text, links, selection, viewport text, and clickable labels.
- `extension/background.js`: captures visible-tab screenshots, opens allowed tabs, saves evidence screenshots, starts the backend through Native Messaging, and enforces an irreversible-action denylist before forwarding safe actions.
- `extension/sidepanel.html`: main UI for page summary, `이 페이지 LLM 판단`, `댓글 LLM 판단`, `금지 이모티콘 탐지`, `이미지 LLM 판단`, issue chips, matched policy rules, LLM reasoning, uncertainty, false-positive risk, recommended action candidates, and side-by-side current-page/policy evidence.
- `src/backend`: Fastify API for policy ingest, retrieval, openai-oauth LLM judge, safety validation, auth status, and audit logging.
- `data/`: generated local policy index, screenshots, openai-oauth logs, and redacted audit logs.

## Setup

```powershell
npm install
Copy-Item .env.example .env
npm run ingest
npm run install:native-host
```

The extension can auto-start the backend after `npm run install:native-host` has been run once. Manual backend start is still useful for debugging:

```powershell
npm run dev:backend
```

## OpenAI OAuth

This project follows the local `GPT-img` OAuth pattern. It does not use `OPENAI_API_KEY`, and it does not ask you to paste an OAuth bearer token.

The backend calls a local `openai-oauth` proxy:

```text
http://127.0.0.1:10531/v1/models
http://127.0.0.1:10531/v1/chat/completions
```

On judgment requests, the backend auto-starts the proxy with:

```powershell
npx -y openai-oauth --port 10531
```

If the side panel or backend says login is required, run this once manually and complete the ChatGPT/OpenAI browser login:

```powershell
npx @openai/codex login
```

The side panel has `Start OAuth proxy`, which asks the Native Messaging host to start only `npx -y openai-oauth --port 10531`. It does not launch `npx @openai/codex login` from Maven.

The login is handled by the OpenAI/Codex OAuth tooling. This extension does not collect or store OpenAI passwords, DCInside passwords, cookies, or session values.

## Load The Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose `Load unpacked`.
4. Select `C:\Users\hub2v\Desktop\Sing2\extension`.
5. If Chrome asks for the new `nativeMessaging` permission, approve it.
6. Open a DCInside gallery post in Chrome. Log in manually if needed.
7. Click the extension action to open the side panel.
8. If the OAuth panel says the proxy is needed, click `Start OAuth proxy`. If the proxy then says login is required, run `npx @openai/codex login` manually outside Maven and retry.
9. Click `이 페이지 LLM 판단` for post text/policy review, `댓글 LLM 판단` for comments only, `금지 이모티콘 탐지` for local forbidden comment-DCCon package-name detection, or `이미지 LLM 판단` for author-uploaded post images only.

`이미지 LLM 판단` excludes DCInside ads, banners, UI chrome, profile icons, and recommendation widgets. For DCInside image hosts, the backend re-downloads the author-uploaded image with the page as Referer, verifies non-empty bytes, and sends a `data:image/...` input so the LLM server does not have to download DC image URLs directly.

`금지 이모티콘 탐지` does not use the LLM. For DCInside comment DCCons, the extension follows the same read-only data path as `디시콘 보기`: it extracts the `no=` code from `written_dccon` media, reads `/dccon/package_detail`, and compares `info.title` with the local forbidden list. Numeric individual icon labels such as `32` or `2` are not treated as emoticon names. The side panel's `금지 이모티콘` list defaults to `갱생특갤콘`, and users can add or remove names there.

Use the bottom `현재 맥락에서 질문` box to ask follow-up questions with the same current page observation, latest judgment card, local policy evidence, and recent chat history.

When a comment UID is not present in the DOM, the extension tries a safe helper observation: click the comment nickname, open `이용자 메모`, and read titles such as `indoor4684 메모`. If that fails, member risk falls back to nickname/IP.

The `닉언콘/친목` seed rule is disabled. Ordinary emoticons, cones, stickers, or nickname mentions alone must not produce delete or ban candidates.

After the native host is installed, the backend no longer has to be started manually. If `http://127.0.0.1:8787` is down, the side panel calls Chrome Native Messaging host `com.dcinside_maven_copilot.backend`, which starts the local Fastify backend and retries the judgment request.

If Chrome shows `Either the '<all_urls>' or 'activeTab' permission is required`, reload the unpacked extension from `chrome://extensions`. The manifest includes both `activeTab` and `<all_urls>` because side-panel initiated screenshot capture can outlive Chrome's temporary `activeTab` grant.

If the extension ID changed after adding the stable manifest key, remove the old unpacked extension and load `C:\Users\hub2v\Desktop\Sing2\extension` again. The expected stable extension ID is `bkedlcocpmapndjabdjgpaonplhlkclm`.

## Allowed And Forbidden Actions

Allowed:

- Copy original post URL.
- Scroll to comments.
- Save evidence screenshot.
- Copy reason text.
- Copy notice draft.
- Copy 특갤봇 command candidate text.
- Open management page in a new tab.
- Prefill an input/textarea for the human to review.
- Record the human's final choice in the local audit log.

Forbidden in both extension and backend:

- Submit, delete, ban/block, post, comment, confirm, save, apply, write-complete, comment-register, or equivalent automatic clicks.

Prefill is intentionally not submit. The human must perform the final browser click.

## Tests

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run smoke:extension
npm run smoke:native-autostart
```

`npm run test:e2e` uses fixture HTML plus Playwright. It checks content extraction, side-panel card rendering, OAuth proxy guidance, backend auto-start retry, and safety blocking without touching live DCInside moderation controls.

`npm run smoke:extension` launches Chromium with the unpacked extension, opens a local fixture page that does not have the content script preloaded, verifies background lazy-injection observation, and sends that observation through the backend mock judge.

`npm run smoke:native-autostart` registers the native host, opens the real extension side panel, leaves the backend stopped on a dedicated test port, and verifies the extension starts it through Native Messaging.

## Live Smoke

Manual live smoke procedure:

1. Run `npx @openai/codex login` manually once if the local OAuth tooling is not already logged in.
2. Load the unpacked extension.
3. In normal Chrome, manually log into DCInside.
4. Open one `thesingularity` post.
5. Open the side panel and click `이 페이지 LLM 판단`.
6. Confirm a judgment card appears with current-page quotes and policy source post numbers.
7. Do not click write, comment, delete, ban, confirm, save, or apply during smoke.

This repository cannot store or replay the DCInside login session. The automated suite covers the read-only extension path using fixtures; live smoke requires the human's existing Chrome session.
