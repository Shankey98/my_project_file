# KTX 특실 감시 앱 — 작업 인계

기준일: **2026-11-25 / 한국 시간**. 아래 상태와 좌석 정보는 당시 확인한 기록이다.

## 0. 2026-11-25 저녁 이어받기 실측 갱신

PC 앱 재시작·Selenium 도우미 개선·기존 Chrome 프로필 연결을 진행했고, **Selenium 연결 시 -8003 원인을 재현**했다.

### 확인한 것
1. PC 앱 서버 정상 시작(`http://127.0.0.1:47831`), 자동 테스트 16/16 통과.
2. 기존 `Selenium(직장)` Profile 1 Chrome은 원격 디버깅으로 켜져 있고, 도우미로 연결·폼 조작·조회 클릭까지 성공.
3. **조건 차이**: Selenium(ChromeDriver/CDP)이 붙은 상태에서 `열차 조회`를 누르면
   결과 목록 페이지(`/ticket/search/list`)로 이동은 되지만 좌석 목록이 나오지 않고,
   추가 상호작용에서 **`-8003`(매크로·개발자도구 등 미허가 도구) 안내 팝업**이 나타난다.
   같은 프로필에서 사용자가 직접 조회했을 때는 정상 목록(기록)이다.
   → 자동화(디버거 연결) 탐지가 원인으로 보인다. 증거: `outputs/ktx-selenium-probe/repro-2026-11-25.json`.
4. **결론/한계**: Selenium으로 코레일 실좌석 데이터를 받아오는 경로는 `-8003`에 막힌다.
   자동 감시·실좌석 확보에는 우회(SeleniumBase UC 등) 또는 자동 조회가 아닌 다른 수단 검증이 필요하고,
   도구 이름만으로 해결을 말하지 말고 실조회로 검증할 것.

### SeleniumBase UC(미탐지) 시도 결과 — 검증 실패(환경 실행 불가)
사용자 선택으로 SeleniumBase UC 우회를 시도했다. `<work/selenium-probe/uc-venv>`에 SeleniumBase 4.59.0(selenium 4.54.0) 설치,
`uc_korail_test.py`/`uc_probe.py` 작성 후 headful·headless2 두 방식 모두 **브라우저 기동 단계에서 멈춤**(드라이버 158.0.8127.88 준비 후
Chrome 실행이 진행되지 않음). 원인은 Chrome 158+이 환경에서의 UC 런처 문제로 보이며, -8003 우회 여부를 검증하지 못했다.
- 설치/스크립트는 남겨 두었음(`work/selenium-probe/uc-venv`, `uc_probe.py`, `uc_korail_test.py`, `uc-result.log`).
- **가설 미확정**: UC가 정상 기동되어도 코레일에서 -8003/차단될 가능성은 여전히 있음. 절대로 'UC 성공'이라 말하지 말 것.

### 대안(이 프로젝트에 이미 있음) — Chrome 확장프로그램 방식 **실측 성공 (2026-11-25)**
외부 드라이버(CDP)를 붙이지 않고 브라우저 페이지 안에서만 동작하는 확장(`outputs/ktx-special/chrome-extension`)으로
korail 조회 결과 탭의 실제 좌석 상태를 읽어 로컬 앱(`127.0.0.1:47831`) `/bridge/snapshot`으로 전달하는 방식.
**실측으로 -8003 없이 정상 동작 확인** (2026-12-05 서울→포항 열차 10개 목록·특실/일반실 상태 수신,
KTX 259 08:35 특실 매진 → 앱 상태 'watching · 특실 매진'). 증거: `outputs/ktx-selenium-probe/extension-verified-2026-11-25.json`.
- 실사용 흐름: 확장 로드(chrome://extensions 개발자 모드) → 앱에서 연결 코드 생성 → 확장 팝업에 입력(페어링) →
  korail 결과 탭에서 확장이 1분 간격 스캔(선택 시 자동 새로고침). 로그인 정보는 읽지 않고 자동 예약은 없음.
- 남은 검증: 특실 'available' 감지 시 앱 경고(특실 표시 발견)·푸시/Slack 알림 실수신, 자동 새로고침(`automatic`) 동작.
- 참고: 12-05 대상 여행은 이 세션에서 API로 추가·감시 활성화했음(`2026-12-05 서울→포항 특실 감시(테스트)`, KTX 259).

### 자동 새로고침의 한계 — `-8002` (2026-11-25 실측)
- 확장의 자동 새로고침(`chrome.tabs.reload`, 55초 주기)이 코레일 **`-8002`**(매크로/미허가 도구) 차단을 유발함.
- 원인 추정: 사람이 한 번 F5하는 것과 네트워크상 동일하지만, **정확히 반복되는 자동 새로고침 패턴**을 봇으로 탐지. (읽기만 하는 것은 통과 — 첫 스냅샷 성공이 근거)
- 추가 확인: 코레일 조회 폼의 **프로그램식 클릭(`element.click()`, isTrusted=false)은 무시됨** → 날짜/역 자동 클릭 이동 불가. (Selenium·확장 모두 동일. 그래서 '다음날' 자동 이동이 실패했음)
- **채택: 안전 반자동 모드** — 자동 새로고침 OFF(기본). 확장은 열려 있는 결과 탭을 **읽기만** 하고(코레일 추가 요청 없음), 사용자가 결과 화면을 **직접 새로고침(F5/다음날)** 하면 그 결과를 읽어 앱에 기록·알림. = 사람 트리거 + 자동 수집.
- 복구: `-8002` 발생 시 코레일 탭 모두 닫고 잠시 후 재접속(안내문: 완전 종료 후 재실행). 일시적 차단임.
- **주의(약관)**: 완전 무인 자동 새로고침은 코레일이 약관상 금지·탐지·차단함. 우회 보장 불가하며 약관 위반 소지가 있어 **회피 도구는 만들지 않는다.**

### 이어받기 중 추가한 도우미 개선 (ExistingProfileHelper.mjs)
- 조회 폼 URL 매칭: `#ktx-profile1-probe` 해시 없이 `/ticket/search/general`(임의 해시/무해시)도 허용. 결과 목록(`/ticket/search/list`)은 계속 제외.
- `observe()`가 각 컨트롤의 `cls`(클래스)·`title` 속성도 반환.
- 명령 `clickText`(텍스트 클릭, XPath) 추가. `index`(1-based)로 n번째 요소 선택 지원.
- `click`/`clickText`는 WebDriver Actions(실 마우스 이동 후 클릭) 사용.

도우미 연결·관찰·명령은 이전과 동일(`outputs/ktx-selenium-probe/.runtime/`), 실행은 `ConnectChrome.cmd`+사용자 Chrome 연결 허용 필요.

## 1. 다음 에이전트에게

기존 프로젝트를 이어서 개발해 주세요. 새로 만들거나 예전 작업 폴더에서 개발하지 마세요.

**가장 먼저 할 일은 기존 Chrome 프로필에서 Selenium으로 실제 열차 조회가 성공하는 조건을 검증하는 것입니다.** 연결과 화면 조작은 성공했지만 조회에서는 `-8003`이 나왔습니다. 이후 사용자가 코레일에 다시 들어가 직접 조회했을 때는 정상 목록이 나왔습니다. 두 상황의 차이를 확인한 뒤 앱 연동과 무료 서버 운영을 진행해야 합니다.

**현재 자동 감시·실제 예약 확보·PC가 꺼진 상태의 24시간 운영은 동작하지 않습니다.** 앱 화면이나 Selenium 연결 성공을 전체 기능 완료로 설명하지 마세요.

## 2. 프로젝트 위치와 실행

모든 작업은 다음 폴더에서 관리합니다.

```text
C:\Users\SEUNGJUN\Documents\project file\KTX-Special
```

| 파일 | 용도 |
| --- | --- |
| `KTX-Special.code-workspace` | VS Code 프로젝트 열기 |
| `README.md` | 전체 구성·사용 안내 |
| `Start.cmd` / `Stop.cmd` | PC 앱 실행 / 종료 |
| `Test.cmd` | 앱 테스트 16개 실행 |
| `ConnectChrome.cmd` | 기존 Chrome 프로필에 Selenium 연결 |
| `RunNode.cmd` | Node.js 실행기 |
| `migration-manifest.json` | 프로젝트 이전·검증 기록 |

PC 앱 주소: `http://127.0.0.1:47831`. Node.js 22 이상을 사용합니다. 현재 PC에서는 Codex 번들 런타임도 자동 탐색합니다.

```powershell
Set-Location -LiteralPath 'C:\Users\SEUNGJUN\Documents\project file\KTX-Special'
.\Test.cmd
.\Start.cmd
```

경로에 공백이 있으므로 셸에서 따옴표를 사용하세요. 도구의 기본 cwd가 예전 위치일 수 있으므로 **workdir를 새 프로젝트 루트로 지정**하세요.

이전 위치는 `C:\Users\SEUNGJUN\Documents\Codex\2026-11-22\d`입니다. 작업 파일은 모두 옮겼고, 그곳에는 새 위치 안내와 실행창이 잡고 있는 빈 폴더만 남겼습니다.

## 3. 사용자와 합의한 최종 요구사항

- 우선 개인용 앱. PC·iPhone·Android에서 사용.
- 날짜가 다른 여러 여행을 각각 감시. 여행마다 여러 후보 열차와 인원을 직접 설정.
- 현재 시험 인원은 성인 1명이며, 제품을 1명 전용으로 만들면 안 됨.
- 특실이 나오면 **예약을 확보하고 알림 전송**. 결제는 사용자가 직접 진행.
- 기존 코레일 일반실 표는 결제 완료 상태라고 설명했음. **원래 표를 자동 취소하지 않음.** 이 사실이 새 시험 날짜의 표에도 적용되는지는 미확인.
- 초기에는 PC가 켜진 동안만 작동해도 된다고 했지만, 이후 **PC가 꺼져도 24시간 작동**하는 요구로 변경됨.
- **무료 서비스만 사용**. 유료 서버·구독을 만들지 않음.
- 초기 자체 앱 알림 요구 이후, 기존 연결 앱 사용도 허용했고 **Slack 알림을 최종 선택·승인**함.
- 사용자가 기존 Chrome의 `Selenium(직장)` 프로필을 활용한 Selenium 방식을 직접 요청함.
- 사용자는 계획만 제시하거나 검증 없이 완료했다고 말하는 것에 불만이 큼. 이미 허용된 개발·조회 작업은 직접 진행하고, 필요한 경우에만 질문.

### 현재 시험 대상

| 항목 | 값 |
| --- | --- |
| 날짜 | 2026-12-05 토요일 |
| 구간 | 서울 → 포항 |
| 열차 | KTX-산천 259번 |
| 시각 | 08:35 출발 → 10:55 도착 |
| 인원 | 성인 1명 |

원래는 11월 23일 열차였으나 날짜가 지나 사용자가 12월 5일로 바꿨습니다. 다음 작업 시 출발일이 지났다면 새 날짜를 받아야 합니다.

사용자가 마지막으로 제공한 정상 조회 화면은 `references/codex-clipboard-fffe62da-5006-42d9-9a00-ddae88a92ed6.png`입니다. 위 조건과 열차가 보이고 좌석 두 칸 모두 매진입니다. **캡처 당시 수동 조회 결과이며 현재 잔여석이나 자동 감시의 증거는 아닙니다.**

## 4. 구현·검증 상태와 파일 위치

아래 경로는 프로젝트 루트 기준입니다.

| 구성 | 위치 | 현재 상태 |
| --- | --- | --- |
| PC·모바일 웹 앱 | `outputs/ktx-special/` | 여행 관리·저장·화면 구현, 테스트 통과 |
| 서버/API | `outputs/ktx-special/server.mjs` | 로컬 실행·인증·저장·종료 구현 |
| 화면/PWA | `outputs/ktx-special/public/` | 반응형 화면·manifest·service worker 구현 |
| 여행 검증·저장 | `outputs/ktx-special/lib/trips.mjs`, `store.mjs` | 구현·자동 검증 |
| 예약 처리 규칙 | `outputs/ktx-special/lib/reservations.mjs` | 테스트 공급자만 사용. 실제 코레일 실행에 연결 안 됨 |
| 자체 푸시 | `outputs/ktx-special/lib/push.mjs` | 암호화·서명 검증. 휴대폰 실수신 미검증 |
| Chrome 연결 | `outputs/ktx-special/lib/chrome-bridge.mjs` | 연결 코드·토큰·조회 결과 검증 구현 |
| Chrome 확장 | `outputs/ktx-special/chrome-extension/` | 실제 설치·연결·반복 갱신·알림 미검증 |
| Selenium 도우미 | `outputs/ktx-selenium-probe/` | 기존 프로필 연결·화면 조작 성공, 조회는 제한 오류 |
| Google 서버 진단 | `outputs/ktx-server-probe/` | 실제 실행했으나 좌석 조회 실패 |
| 의존성·조사 자료 | `work/` | Selenium·드라이버·조사 스크립트·캐시 |
| 사용자 제공 자료 | `references/` | 화면 캡처 4개와 붙여넣은 텍스트 |

### 앱에서 가능한 것

여행 등록·수정·복사·삭제, 후보·날짜·역·인원 설정, 감시 요청 저장/해제, 백업, 활동 기록을 구현했습니다. 현재 구현 제한은 여행당 1~9명, 후보 1~20개, 여행 최대 100개입니다. 이는 사용자가 정한 상한은 아닙니다.

`감시 요청 저장`은 실제 코레일 조회나 예약을 시작하지 않습니다. 예약 규칙의 테스트 통과도 실제 예약 확보를 의미하지 않습니다.

### 보존해야 할 실제 데이터

- `outputs/ktx-special/.local/state.json`: 사용자 여행·설정.
- `outputs/ktx-special/.local/push-keys.json`: 푸시 키.
- 개인 여행 이름·메모·키·브라우저 세션을 문서나 공개 배포본에 노출하지 마세요.
- 사용자 원본 여행을 테스트 데이터로 덮어쓰지 마세요.

### 이전 후 검증 완료

파일 **1,007개**를 옮겨 SHA-256 무결성을 확인했습니다. Selenium 의존성의 Windows Junction **35개**와 pnpm 경로를 새 위치로 수정했습니다. 새 위치에서 **테스트 16개 통과**, Selenium 의존성 로드, 프로젝트 JSON, 기존 데이터 폴더를 사용한 앱 시작·정상 종료를 확인했습니다. 저장 JSON 2개는 원본과 동일했습니다.

인계 시 PC 앱과 Selenium 연결은 종료한 상태입니다. 사용자 Chrome은 닫지 않았습니다. 이후 실행 여부는 다시 확인하세요.

설치해 둔 압축해제 Chrome 확장은 새 폴더 `outputs/ktx-special/chrome-extension`로 다시 로드해야 합니다. 사용자에게 안내했으나 실제 재로드 여부는 미확인입니다.

## 5. Selenium 문제 — 다음 검증의 핵심

### 지금까지 확인한 사실

1. 새 시험 Chrome 프로필에서는 headless·일반 창 모두 초기 `tab crashed`가 발생했습니다. 페이지 접근 전 환경 충돌이므로 코레일 차단으로 단정하지 않았습니다.
2. 기존 `Selenium(직장)` 프로필은 Chrome의 `Profile 1`입니다. 실제 UI 이름은 `Selenuim`처럼 표시됐습니다.
3. 사용자가 `chrome://inspect/#remote-debugging`의 연결 허용을 직접 켜고 Chrome 연결을 승인했습니다.
4. 에이전트 런타임은 `DevToolsActivePort` 읽기가 EPERM이어서, 사용자가 직접 실행하는 도우미를 만들었습니다. 관리자 권한은 필요 없습니다.
5. Chrome 새 연결 서버의 `/json/version` 404를 localhost 어댑터로 보완했습니다. 어댑터의 `WebKit-Version` 누락 버그도 수정했습니다.
6. 이후 기존 프로필에 Selenium 연결, DOM 읽기, 역·날짜·시간 선택과 조회 버튼 클릭까지 성공했습니다.
7. 실제 조회에서는 코레일의 미허가 도구 안내 **`-8003`**이 표시됐습니다. 같은 화면의 '운행하는 열차가 없습니다'를 정상 결과로 해석하면 안 됩니다.
8. 도우미 연결을 종료한 뒤 사용자가 기존 화면에서 재조회했을 때는 오류가 남았지만, **코레일에 다시 들어가 직접 조회하니 정상**이라고 정정했습니다.

**아직 모르는 것:** Selenium 연결을 유지한 채 새로 진입해도 정상 조회되는지, 사용자가 원격 디버깅 설정을 껐는지, 페이지·브라우저·세션 중 어디에 제한 상태가 남았는지. 계정 전체 차단이나 특정 원인을 확정하지 마세요.

### 현재 연결 코드

- `outputs/ktx-selenium-probe/ExistingProfileHelper.mjs`: 최신 도우미 본체.
- `LaunchHelper.mjs`: 실패 후 소스가 수정되면 한 번 재시도하는 실행기.
- `RunExistingProfile.cmd`: 루트 `ConnectChrome.cmd`에서 호출.
- `AttachExistingChrome.mjs`: 초기 직접 연결 시도. 최신 어댑터 경로가 아님.
- `work/selenium-probe/`: Selenium 의존성과 `command.mjs`, 시험 스크립트.
- `work/selenium-probe/driver-cache/`: ChromeDriver 캐시.

시작 시 다음 표시 URL을 정확히 하나 찾습니다. 현재 결과 목록 탭만 있으면 시작에 실패할 수 있습니다.

```text
https://www.korail.com/ticket/search/general#ktx-profile1-probe
```

도우미는 Chrome의 연결 주소 파일만 읽으며 쿠키·비밀번호·Local State를 추출하지 않습니다. 127.0.0.1 어댑터를 통해 연결하고 사용자 Chrome 닫기 명령을 차단합니다.

새 실행 상태·명령·결과는 `outputs/ktx-selenium-probe/.runtime/`에 생성됩니다. 명령은 observe/click(CSS)/type/key/stop입니다. 이 도우미는 조회 전용이며 예약·결제·취소·로그인 클릭은 막습니다.

이전의 `.runtime`은 `work/session-history/selenium-runtime-before-move/`로 옮겼습니다. **그곳의 connected=true, PID, 포트, 세션 ID는 과거 기록입니다.** `work/selenium-probe/next-command.json` 역시 확인 없이 재전송하지 마세요. 새 경로에서 Chrome 재연결까지 검증한 것은 아닙니다.

CSS 명령함이 불편해 실제 조회 때는 도우미가 생성한 기존 ChromeDriver 세션에 JS Selenium 클라이언트를 붙여 XPath로 제어했습니다. 당시 포트나 REPL 변수는 재사용하지 말고 현재 세션을 확인해야 합니다. 종료할 때 사용자 브라우저에 `quit()`/`close()`를 보내지 말고 도우미 stop 또는 Ctrl+C를 사용하세요.

당시 버전: Selenium **4.54.0**, Chrome **158.0.8127.37**, ChromeDriver **158.0.8127.88**. 다음 실행 때 Chrome 업데이트 여부를 확인하세요.

### 화면 조작 참고

공개 JS 번들에서 추정한 클래스와 실제 DOM이 달랐으므로 현재 화면을 기준으로 선택자를 확인하세요. 당시에는 날짜 input `#startDate` 옆 `a[title="출발일"]`로 달력을 열고, `.datepk_wrap .slick-current` 안에서 날짜를 선택했습니다. 시간은 `.slideWrap`에서 08시를 선택하고 적용한 뒤 `button.btn_lookup`를 눌렀습니다. readonly input이나 내부 상태를 직접 바꿔 성공으로 표시하지 마세요.

### 증거 파일

- `outputs/ktx-selenium-probe/existing-profile-query-result.json`
- `outputs/ktx-selenium-probe/existing-profile-query-error.png`
- `references/codex-clipboard-56550381-7268-4fa2-bd8a-e4449deea90d.png`: 사용자 오류 화면.
- `references/codex-clipboard-fffe62da-5006-42d9-9a00-ddae88a92ed6.png`: 이후 정상 수동 조회.

## 6. 무료 서버와 Slack — 완료되지 않은 부분

### Google Apps Script

`outputs/ktx-server-probe/`에 코드·안내·실제 결과가 있습니다. 실제 Google 프로젝트 링크는 `실행안내.txt`에 있습니다.

- HTML 페이지 HTTP 200은 성공했지만 좌석 데이터가 아니었습니다.
- 과거 앱 방식 요청은 `MACRO ERROR`였습니다. 처음 오류 분류에서 공백 포함 코드를 놓쳤고 이후 수정했습니다.
- 당시 웹 규격 BH·Version 999999999·POST로 바꿔도 Google에서는 `macro_err1`/`ACCESS_RESTRICTED`였습니다. 증거는 `google-web-result.json`입니다.
- PC 직접 HTTP 시험의 `-4001`, Selenium 화면의 `-8003`, 새 프로필의 `tab crashed`는 각각 다른 결과입니다.
- Apps Script에는 Selenium/Chrome 실행 기능이 없습니다. 브라우저가 필요한 경우 별도 환경을 검증해야 합니다.
- 자동 감시 트리거·실제 예약·Google→Slack 웹훅은 구성하지 않았습니다.

Cloudflare와 GitHub Actions는 후보로 조사만 했습니다. Cloudflare 무료 브라우저 사용량은 당시 하루 10분으로 확인했으며 충분한 감시 주기는 미검증입니다. 사용자는 Cloudflare 계정이 없고 가입이 꼭 필요하냐고 물었습니다. 계정 생성부터 요구하지 마세요. 무료 한도와 스케줄 지연은 실제 운영 후보를 정할 때 다시 확인하세요. 집 PC의 self-hosted runner 예제를 PC 없는 서버 운영으로 소개하면 안 됩니다.

### Slack

- 워크스페이스 **MARTIN**, 채널 **#gpt-알림**, ID **C0CKTV4BWAX**.
- 사용자가 채널을 만들고 알림 전송을 명시적으로 승인했습니다.
- Codex Slack 도구로 연결 테스트와 실제 실패 결과 전송에 성공했습니다.
- 최근 결과 메시지: https://martin-n0o7096.slack.com/archives/C0CKTV4BWAX/p1795606805475549
- **앱/서버 자체 전송 자격 정보나 웹훅은 미설정**입니다. Codex의 전송 성공을 무인 서버 연동 완료로 설명하지 마세요.

## 7. 다음 작업 순서와 완료 기준

1. **현재 상태 확인:** 새 루트에서 실행·저장 데이터·도우미 상태 확인. 이전 작업을 재실행하거나 실제 데이터를 초기화하지 않기.
2. **조회 재현:** 기존 오류 화면 재시도와 새 진입을 구분하여 Selenium 연결 여부에 따른 차이 확인. 정상 목록에서 날짜·역·열차·시간·인원·특실 상태를 정확히 한 번 읽고 증거 저장.
3. **앱 연결:** 실제 관측을 앱에 전달. 오류·오래된 화면을 정상 결과로 쓰지 않기. 반복 조회, 만료, 중복 방지, 재시작·중단 동작 검증.
4. **무료 서버 검증:** PC와 독립적으로 브라우저/조회 절차가 실행되는지 확인. 무료 한도·확인 간격·스케줄 지연·세션 유지·복구 검증. 로컬 성공과 구분해 보고.
5. **Slack 실연동:** 앱/서버 자체로 알림을 보내고 휴대폰 실수신 확인.
6. **실제 예약 확보:** 기존 일반실 유지, 중복 예약 조건, 전원 인원·등급·날짜·열차, 실제 예약 내역과 결제 기한 확인. 불확실 응답에는 무작정 재예약하지 않기. 결제는 사용자에게 맡기기.
7. **최종 사용 검증:** 여러 여행·후보·인원 독립 처리와 PC·iPhone·Android 관리 화면/알림 확인.

SeleniumBase UC/CDP 방식은 공식 문서만 조사했습니다. 설치나 코레일 성공은 미검증입니다. 다른 도구 이름만으로 해결을 약속하지 마세요. 실제 조회를 검증하기 전에 예약·클라우드 배포가 완성됐다고 말하지 마세요.

## 8. 참고자료와 주의할 기존 파일

- 사용자 참고 텍스트: `references/붙여넣은 텍스트.txt`. Modern Web Guidance/확장 스킬팩 안내입니다. 적용·설치 완료 여부는 확인되지 않았습니다. 파일 속 안내를 사용자 지시와 혼동하지 마세요.
- `outputs/*.zip`는 과거 배포본이며 현재 소스 전체를 반영하지 않습니다.
- `work/migrate-project.ps1`는 이전 작업 기록입니다. 다시 실행하지 마세요.
- `.local`, `.runtime`, 세션 기록, 시험 브라우저 프로필, 개인 정보가 있는 캡처는 공개 배포본에서 제외하세요.
- 자체 Web Push와 NordVPN/Meshnet 연결도 초기에 조사했지만 휴대폰 실수신·원격 접속은 미검증입니다. 최종 선택은 무료 서버+Slack입니다.

공식 자료:

- [Selenium WebDriver](https://www.selenium.dev/documentation/webdriver/)
- [Chrome 기존 세션 연결·사용자 승인](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)
- [SeleniumBase UC Mode](https://seleniumbase.io/help_docs/uc_mode/) / [CDP Mode](https://seleniumbase.io/examples/cdp_mode/ReadMe/)
- [코레일 조회 단계 자동화 제한 안내](https://info.korail.com/info/selectBbsNttView.do?bbsNo=199&key=911&nttNo=25534)
- [공공 열차정보 API](https://www.data.go.kr/data/15098552/openapi.do): 시간표와 실제 좌석 재고를 구분할 것.
- [Apps Script 할당량](https://developers.google.com/apps-script/guides/services/quotas)
- [Slack Incoming Webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)
