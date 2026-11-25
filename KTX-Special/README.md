# 특실로 · KTX Special

관리 위치: `C:\Users\SEUNGJUN\Documents\project file\KTX-Special`.
앱, Chrome 확장 프로그램, Selenium 도우미, Google 서버 진단 코드, 여행 설정과 이전 결과를 이 프로젝트에서 관리합니다.

다른 에이전트가 이어서 작업할 때는 [HANDOFF.md](HANDOFF.md)를 먼저 읽습니다. 요구사항, 검증 이력, 파일 위치와 남은 작업을 정리했습니다.

## 열기와 실행

- `KTX-Special.code-workspace`: VS Code 프로젝트 열기 파일.
- `Start.cmd`: PC 앱 실행. 주소는 `http://127.0.0.1:47831`.
- `Stop.cmd`: 이 프로젝트의 PC 앱 종료.
- `Test.cmd`: 앱 자동 검증 실행.
- `ConnectChrome.cmd`: 기존 Chrome 프로필 연결 도우미. 사용자의 Chrome 연결 승인이 필요하며 실행만으로 감시나 예약이 시작되지는 않습니다.

Node.js 22 이상을 사용합니다. 이 PC에서는 설치된 Node.js가 없으면 Codex의 포함 런타임을 찾아 실행합니다.
내부 실행 경로는 프로젝트 기준 상대 경로를 사용하며 공백이 있는 폴더를 지원합니다.

## 구성

| 위치 | 내용 |
| --- | --- |
| `outputs/ktx-special/` | PC·모바일 웹 앱과 테스트 |
| `outputs/ktx-special/chrome-extension/` | Chrome 연결 확장 프로그램 |
| `outputs/ktx-special/.local/` | 여행 설정·알림 키·앱 실행 기록 |
| `outputs/ktx-selenium-probe/` | 기존 Chrome 연결 코드와 조회 증거 |
| `outputs/ktx-server-probe/` | Google Apps Script 서버 조회 진단 |
| `outputs/*.zip` | 이전 버전 배포본. 현재 소스와 구분하여 보관 |
| `work/` | 조사 스크립트, Selenium 의존성·드라이버, 캐시와 임시 결과 |
| `work/session-history/` | 이전 Selenium 세션 기록. 활성 연결 정보로 사용하지 않음 |
| `migration-manifest.json` | 이전 당시 파일 무결성 확인 목록 |
| `references/` | 사용자가 제공한 화면 캡처와 참고 텍스트 원본 사본 |

Chrome에 예전 폴더의 확장 프로그램을 설치했다면 `chrome://extensions`에서 예전 항목을 제거하고,
개발자 모드의 '압축해제된 확장 프로그램을 로드합니다'로 이 프로젝트의
`outputs/ktx-special/chrome-extension` 폴더를 다시 선택합니다. Chrome의 로드 경로는 파일 이동만으로 바뀌지 않습니다.

## 현재 확인된 상태

2026-11-25 기존 Chrome Profile 1에 Selenium을 연결하고 화면 조작까지 성공했습니다.
연결 상태의 실제 조회에서는 코레일 `-8003` 안내가 표시됐습니다.
이후 사용자가 코레일에 다시 접속하여 직접 조회한 캡처에서 2026-12-05 서울→포항,
KTX-산천 259번 08:35~10:55와 좌석 두 칸의 매진 표시를 확인했습니다.
수동 조회 복구의 증거이며 Selenium 자동 조회 성공을 뜻하지 않습니다.

무료 서버에서 PC가 꺼진 동안의 24시간 감시와 특실 자동 예약은 아직 작동하지 않습니다.
Slack 연결 전송 테스트는 성공했으며 수신 채널은 `C0CKTV4BWAX`입니다.

여행 데이터와 알림 키는 이동 전후 원본을 보존했습니다.
`.local`, `.runtime`, 세션 기록, 브라우저 시험 프로필은 배포본과 분리합니다.
이후 개발과 실행은 이 프로젝트 폴더를 기준으로 진행합니다.

## 이전 검증

기존 작업의 파일 1,007개를 이동하고 SHA-256으로 무결성을 확인했습니다.
Selenium 의존성의 Windows 연결 35개와 패키지 관리자 경로를 새 위치로 수정했습니다.
새 폴더에서 자동 검증 16개 통과, Selenium 의존성 로드, 프로젝트 JSON,
기존 데이터 폴더를 사용한 앱 시작과 정상 종료를 확인했습니다.
예전 작업 폴더에는 새 위치 안내 파일과 실행창이 잡고 있는 빈 폴더만 남아 있습니다.
