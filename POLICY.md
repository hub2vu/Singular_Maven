# Policy Operating Notes

## Corpus

Canonical local corpus:

`C:\Users\hub2v\Desktop\Sing2\dcinside_manager_posts_thesingularity_2026-06-02.json`

The ingester reads post number, title, body, comments, image URLs, and links. It writes a local JSON index under `data/policy-index.json`. The Markdown report is not the canonical ingest source because the file is mojibaked in this workspace.

Sensitive files such as `ID_비밀번호.txt` are excluded and must never be read, indexed, logged, or sent to an LLM.

## LLM-First Judgment

Retrieval finds relevant evidence posts and seed rules. It does not decide moderation outcomes. The LLM judge receives:

- Current-page observation from the extension.
- Image URLs, alt text, and nearby text.
- Visible screenshot if `ENABLE_VISION=1`.
- Retrieved policy evidence with `source_post_no`.
- Safety constraints.

The returned judgment card must include `final_human_decision_required: true`.

## Issue Types

- 이왜특/갤무관
- 정떡
- 닉언콘/친목
- 완장고로시
- 도배기/역류기
- 이미지 리스크
- 수익/홍보/강의팔이
- 타커뮤 캡처/조롱
- 요주의 계정/IP/VPN
- 특갤봇 명령 후보

## Seed Rules

- Since 2026-06-01, 닉언콘 is treated as 친목질 and is a 31-day ban candidate. Seed source posts include `1224888`, `1224783`, `1224760`, `1225924`, `1224960`, and `1216079`.
- `@특갤봇 게시물방어(n)`, `@특갤봇 댓글방어(n)`, and `@특갤봇 방어(n)` require integer `n` from 1 to 10. Main source post: `1226405`.
- `@특갤봇 게시물번호` is a specific-post push-down candidate, not an automatic delete action. Main source posts include `1206943` and `1206659`.
- 정떡, 이왜특, 도배기, 이미지, 홍보/수익글, and 완장고로시 are retrieved from the local corpus and compared by the LLM against the observed page.

## Safety Contract

Allowed commands are copy, scroll, evidence screenshot save, notice/reason/bot-command draft copy, management tab open, input prefill, and local final-choice audit logging.

Denied automation labels include:

`삭제`, `차단`, `등록`, `작성완료`, `댓글등록`, `확인`, `저장`, `적용`, `전송`, `완료`, `게시`, `발행`, `delete`, `ban`, `submit`, `post`, `comment`, `confirm`, `save`, `apply`, `send`, `publish`.

The extension background worker, content script safety broker, and backend `/api/action/validate` endpoint all enforce this denylist.
