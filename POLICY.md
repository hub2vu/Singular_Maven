# Policy Operating Notes

## Corpus

Canonical local corpus:

`C:\Users\hub2v\Desktop\Sing2\dcinside_manager_posts_thesingularity_2026-06-02.json`

The ingester reads post number, title, body, comments, image URLs, and links directly from the canonical JSON corpus. It does not write or use `data/policy-index.json` as a judgment source. The Markdown report is not the canonical ingest source because the file is mojibaked in this workspace.

The 2026-06-13 public gallery rules are layered in as seed policy documents during ingest, so the older manager-post corpus is supplemented with the current notice.

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
- 이용약관/법률/사회통념
- 정떡
- 정치/지역/성별혐오
- 닉언/친목/사칭
- 분탕/어그로
- 종교/음모론
- 반과학/유사과학
- 선형글/레퍼런스 부족
- 인증/팬보이/갈드컵
- 완장고로시
- 도배기/역류기
- 이미지 리스크
- 수익/홍보/강의팔이
- 프로그램 홍보
- 주식/코인/투자
- 국뽕/출산율/혐오떡밥
- 타커뮤 캡처/조롱
- 타갤/타커뮤 언급
- 요주의 계정/IP/VPN
- 비관론갤 활동
- 허위사실/이미지 저해
- 욕설싸움/분쟁
- 금지 떡밥
- 개념글 제한
- 레퍼런스 기준
- 허용 예외
- 특갤봇 명령 후보

## Seed Rules

- The 2026-06-13 public notice is represented by `seed-2026-06-13-*` rules, including nickname/clique/impersonation, religion/conspiracy, anti-science, unreferenced anti-singularity claims, reference standards, politics/hate, investment, banned topics, allowed exceptions, and program promotion.
- `@특갤봇 게시물방어(n)`, `@특갤봇 댓글방어(n)`, and `@특갤봇 방어(n)` require integer `n` from 1 to 10. Main source post: `1226405`.
- `@특갤봇 게시물번호` is a specific-post push-down candidate, not an automatic delete action. Main source posts include `1206943` and `1206659`.
- Policy seed rules and local corpus evidence are retrieved by keyword/category and compared by the LLM against the observed page. Retrieval is evidence selection, not an automatic final verdict.

## Safety Contract

Allowed commands are copy, scroll, evidence screenshot save, notice/reason/bot-command draft copy, management tab open, input prefill, and local final-choice audit logging.

Denied automation labels include:

`삭제`, `차단`, `등록`, `작성완료`, `댓글등록`, `확인`, `저장`, `적용`, `전송`, `완료`, `게시`, `발행`, `delete`, `ban`, `submit`, `post`, `comment`, `confirm`, `save`, `apply`, `send`, `publish`.

The extension background worker, content script safety broker, and backend `/api/action/validate` endpoint all enforce this denylist.
