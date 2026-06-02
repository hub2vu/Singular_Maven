# DCInside Maven Copilot

DCInside `thesingularity` gallery moderation review를 돕는 Chrome Extension + local backend + Native Messaging Host 실행 패키지입니다.

이 저장소는 실행에 필요한 코드와 policy corpus를 포함합니다. `.codex`, skills, GPT-img, `node_modules`, 기존 `data/` audit/log 산출물은 포함하지 않습니다.

## 포함 내용

- `extension/`: Chrome Manifest V3 확장 프로그램
- `src/`: local Fastify backend
- `scripts/install-native-host.mjs`: Chrome Native Messaging Host 등록 스크립트
- `scripts/native-host/`: backend와 `openai-oauth` proxy를 시작하는 native host
- `dcinside_manager_posts_thesingularity_2026-06-02.json`: policy corpus
- `.env.example`: 로컬 설정 예시

## 요구 사항

- Windows
- Node.js 20 이상 권장
- Google Chrome 또는 Chromium
- OpenAI/Codex OAuth login이 가능한 환경

## 설치

```powershell
git clone https://github.com/hub2vu/Singular_Maven.git
cd Singular_Maven
npm install
Copy-Item .env.example .env
npm run ingest
npm run install:native-host
```

`npm run install:native-host`는 현재 extension id에 맞춰 Windows registry에 Native Messaging Host를 등록합니다. 이 단계는 한 번만 실행하면 됩니다.

## Chrome Extension 로드

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 `Developer mode`를 켭니다.
3. `Load unpacked`를 누릅니다.
4. 이 저장소의 `extension` 폴더를 선택합니다.
5. DCInside 게시글 페이지를 엽니다.
6. 확장 프로그램 아이콘을 눌러 side panel을 엽니다.

## Backend 실행

수동으로 backend를 실행하려면:

```powershell
npm run dev:backend
```

기본 backend 주소:

```text
http://127.0.0.1:8787
```

Native Messaging Host가 설치되어 있으면 side panel이 backend 연결 실패 시 자동 시작을 시도합니다.

## OpenAI OAuth Proxy

이 패키지는 GPT-img 방식과 같은 local `openai-oauth` proxy를 사용합니다.

```text
http://127.0.0.1:10531
```

side panel에 `login/proxy needed`가 표시되면 `Start OAuth proxy`를 누릅니다. 로그인 자체가 필요하다는 메시지가 나오면 Maven 확장 안에서 로그인하지 말고, 별도 터미널에서 아래 명령을 직접 실행합니다.

```powershell
npx @openai/codex login
```

Maven Copilot은 OpenAI API key나 수동으로 붙여넣은 bearer token을 저장하지 않습니다.

## 사용 순서

1. `npm run dev:backend`를 실행하거나 Native Messaging Host 자동 시작을 사용합니다.
2. Chrome에서 DCInside 게시글을 엽니다.
3. Maven side panel을 엽니다.
4. 필요하면 `Start OAuth proxy`를 누릅니다.
5. 모델을 선택합니다.
6. 텍스트/댓글/정책 근거 중심 검토는 `이 페이지 LLM 판단`을 누릅니다.
7. 게시글 작성자가 업로드한 이미지 자체를 별도로 보려면 `이미지 LLM 판단`을 누릅니다. 이 버튼은 DCInside 광고, 배너, UI 이미지를 제외하고 본문 업로드 이미지만 LLM 비전 입력으로 보냅니다.
8. 판단 카드, policy evidence, local member risk, audit log를 확인합니다.

댓글 작성자의 UID가 DOM에 바로 없을 때는 side panel 관측 과정에서 댓글 닉네임의 `이용자 메모` 창을 열어 `indoor4684 메모` 같은 제목에서 UID를 보조 확인합니다. 실패하면 기존 닉네임/IP 기반으로 계속 동작합니다.

`닉언콘/친목` seed 규칙은 제외되어 있습니다. 단순 이모티콘, 콘, 스티커, 닉네임 언급만으로 삭제 후보나 차단 후보를 만들지 않도록 프롬프트에도 명시되어 있습니다.

이미지 판단은 원격 DC 이미지 URL을 그대로 LLM에 맡기지 않고, DCInside 이미지 호스트의 경우 backend가 게시글 URL을 Referer로 붙여 다시 다운로드한 뒤 0바이트가 아닌지 확인하고 `data:image/...` 입력으로 변환합니다. 이 방식은 LLM 서버가 DC 이미지 URL을 직접 다운로드하다가 빈 파일이나 404를 받는 문제를 피하기 위한 것입니다.

맨 아래 `현재 맥락에서 질문` 입력창을 사용하면 현재 게시글 관측값, 최근 판단 카드, local policy evidence, 최근 대화 이력을 같은 맥락으로 묶어 후속 질문을 할 수 있습니다.

## 저장 위치

실행 중 생성되는 파일은 `data/` 아래에 저장됩니다.

- `data/policy-index.json`: policy corpus index
- `data/member-profiles.json`: local member risk profile
- `data/audit/`: redacted LLM judgment audit log
- `data/screenshots/`: 저장된 evidence screenshot
- `data/openai-oauth.log`: OAuth proxy log

`data/`는 git에 포함하지 않습니다.

## 안전 정책

이 도구는 읽기 전용 검토 도구입니다. 자동으로 삭제, 차단, 등록, 댓글 작성, 저장, 적용, 확인 같은 되돌리기 어려운 관리 동작을 수행하지 않습니다.

허용되는 작업은 복사, 스크롤, screenshot 저장, 관리 페이지 열기, reason prefill, audit 기록처럼 사람이 최종 판단을 유지하는 동작입니다.

## 문제 해결

### `POST:/api/members/observe not found`

오래된 backend가 `8787` 포트에 떠 있는 상태입니다. 기존 프로세스를 종료하고 최신 backend를 다시 시작하세요.

```powershell
npm run dev:backend
```

### `spawn EINVAL`

Windows에서 `npx.cmd` 배치 래퍼를 detached로 실행할 때 생길 수 있는 문제입니다. 현재 패키지는 `node.exe`가 `npx-cli.js`를 직접 실행하도록 구성되어 있습니다. 최신 코드를 받은 뒤 backend를 재시작하세요.

### `login/proxy needed`

먼저 side panel의 `Start OAuth proxy`를 누릅니다. 그래도 login이 필요하다고 나오면 별도 터미널에서 실행합니다.

```powershell
npx @openai/codex login
```

## 개발용 명령

```powershell
npm run typecheck
npm run build
```
