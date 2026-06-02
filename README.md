# DCInside Maven Copilot Extension

DCInside Maven Copilot의 Chrome 확장 프로그램 파일만 담은 저장소입니다.

이 저장소에는 `extension/` 디렉터리만 포함되어 있으며, backend, native host, skills, GPT-img, node modules, 테스트 산출물은 포함하지 않습니다.

## 포함 파일

- `extension/manifest.json`
- `extension/background.js`
- `extension/content.js`
- `extension/sidepanel.html`
- `extension/sidepanel.css`
- `extension/sidepanel.js`

## Chrome에 확장 프로그램 로드하기

1. 이 저장소를 내려받거나 압축을 풉니다.
2. Chrome에서 `chrome://extensions`를 엽니다.
3. 오른쪽 위 `Developer mode`를 켭니다.
4. `Load unpacked`를 누릅니다.
5. 이 저장소 안의 `extension` 폴더를 선택합니다.
6. DCInside 게시글 페이지를 엽니다.
7. 확장 프로그램 아이콘을 눌러 side panel을 엽니다.

## Backend 연결

확장은 기본적으로 아래 로컬 backend를 사용합니다.

```text
http://127.0.0.1:8787
```

side panel의 `Backend` 입력칸에서 주소를 바꿀 수 있습니다.

이 저장소에는 backend 프로그램이 포함되어 있지 않습니다. LLM 판단을 사용하려면 별도로 DCInside Maven Copilot backend가 실행 중이어야 합니다.

## OpenAI OAuth Proxy

side panel은 GPT-img 방식과 같은 로컬 `openai-oauth` proxy를 사용합니다.

```text
http://127.0.0.1:10531
```

side panel에 `login/proxy needed`가 표시되면 `Start OAuth proxy`를 누릅니다. 로그인 자체가 필요하다는 메시지가 나오면 Maven 확장 안에서 로그인하지 말고, 별도 터미널에서 아래 명령을 직접 실행합니다.

```powershell
npx @openai/codex login
```

## 안전 정책

이 확장은 읽기 전용 검토 도구입니다. 자동으로 삭제, 차단, 등록, 댓글 작성, 저장, 적용, 확인 같은 되돌리기 어려운 관리 동작을 수행하지 않습니다.

## 주의

이 저장소는 확장 프로그램 파일만 배포하기 위한 저장소입니다. backend 자동 시작, native messaging host 설치, policy corpus, audit log 저장 기능은 이 저장소만으로는 제공되지 않습니다.
