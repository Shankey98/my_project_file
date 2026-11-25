const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  ticket: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M15 5v14M7 9h4M7 13h4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  link: '<path d="m10 13 4-4M8 15l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0m0 2 2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-6 0" transform="translate(2 0)"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  train: '<rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M12 3v8M8 22l2-3M16 22l-2-3M8 15h1M15 15h1"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 21v-4a5 5 0 0 0-2-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  laptop: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M2 20h20l-2-4H4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
function fillIcons(root = document) { $$('[data-icon]', root).forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
let state = null, editingId = null, deletingId = null, filter = 'all', online = false, lastFingerprint = '', pushBusy = false;
const form = $('#trip-form');
const route = () => ['trips', 'notifications', 'connection'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'trips';
const kDate = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value));
const kTime = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const toKoreaInput = value => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000); }
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '요청을 처리하지 못했어요.'); error.status = response.status; throw error; }
  return result;
}
function markOnline(value) {
  online = value;
  $('#connection-pill').textContent = value ? 'PC 연결됨' : 'PC 연결 끊김';
  $('#connection-pill').classList.toggle('offline', !value);
  $('#offline-banner').hidden = value;
  if ($('#heartbeat-time') && value) $('#heartbeat-time').textContent = kTime(Date.now());
}
async function refresh(force = false, retried = false) {
  try {
    state = await api('/state'); markOnline(true);
    $('#gate').hidden = true; $('#shell').hidden = false;
    $('#nav-count').textContent = state.trips.length;
    const fingerprint = JSON.stringify([state.trips, state.events, state.push.devices, state.push.contact, state.connection.chrome]);
    if (force || fingerprint !== lastFingerprint) {
      if (force || !$('#view').contains(document.activeElement) || !document.activeElement.matches('input,textarea,select')) { render(); lastFingerprint = fingerprint; }
    }
    return true;
  } catch (error) {
    if (error.status === 401 && !retried && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
      try { await api('/local-session', { method: 'POST', body: {} }); return await refresh(force, true); } catch { /* Show pairing/offline state below. */ }
    }
    if (error.status === 401) { $('#gate').hidden = false; $('#shell').hidden = true; }
    markOnline(false); return false;
  }
}
function activityMarkup() {
  return state.events.length ? `<ol class="activity">${state.events.slice(0, 5).map(item => `<li><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p><time>${esc(kTime(item.at))}</time></li>`).join('')}</ol>` : '<p class="activity-empty">아직 새로운 소식이 없어요.<br>여행을 등록하면 이곳에 기록돼요.</p>';
}
function setupMarkup() {
  const devices = state.push.devices.length;
  return `<div class="side-card"><h2>내 여행 준비 상태</h2>
    <div class="setup-step"><span class="step-marker done">${icon('check')}</span><div><strong>PC 앱 실행</strong><p>지금 이 PC와 연결되어 있어요.</p></div></div>
    <a href="#connection" class="setup-step"><span class="step-marker ${state.connection.chrome?.live ? 'done' : ''}">${icon('link')}</span><div><strong>기존 Chrome 조회 연결</strong><p>${state.connection.chrome?.live ? '화면 결과 연결됨 · 자동 예약은 미연결' : '확장프로그램을 연결해 주세요.'}</p></div></a>
    <a href="#notifications" class="setup-step"><span class="step-marker ${devices ? 'done' : ''}">${icon(devices ? 'check' : 'bell')}</span><div><strong>자체 알림 연결</strong><p>${devices ? `${devices}대 등록 · 테스트 수신을 확인해 주세요.` : '기기를 등록하고 푸시를 테스트해요.'}</p></div></a>
  </div>`;
}
function tripCard(trip) {
  const total = Object.values(trip.passengers).reduce((a, b) => a + b, 0), status = trip.status;
  const who = [['adult', '어른'], ['child', '어린이'], ['senior', '경로']].filter(([kind]) => trip.passengers[kind]).map(([kind, name]) => `${name} ${trip.passengers[kind]}명`).join(' · ');
  return `<article class="trip-card" data-trip="${trip.id}">
    <div class="trip-card-head"><div><h3>${esc(trip.name)}</h3><span class="trip-date">${esc(kDate(`${trip.date}T12:00:00+09:00`))}</span></div><span class="badge ${esc(status.code)}">${esc(status.label)}</span></div>
    <div class="route"><div class="route-station"><strong>${esc(trip.from)}</strong><small>출발</small></div><span class="route-line">${icon('train')}</span><div class="route-station"><strong>${esc(trip.to)}</strong><small>도착</small></div></div>
    <div class="train-tags">${trip.trains.map(train => `<span class="train-tag"><b>KTX ${esc(train.number)}</b>${esc(train.time)}</span>`).join('')}</div>
    <div class="trip-details"><span title="${esc(who)}">${icon('people')}${total}명 · 특실</span><span>${trip.seatPolicy === 'all' ? '전원 확보 조건' : '일부 좌석 시 직접 확인'}</span><span>${trip.existingTicket === 'paid' ? '기존 일반실 결제 완료' : trip.existingTicket === 'unpaid' ? '기존 표 미결제' : '기존 표 없음'}</span></div>
    ${status.checkedAt ? `<div class="trip-details">${icon('clock')}Chrome 화면 확인 ${esc(kTime(status.checkedAt))}</div>` : ''}
    ${trip.reservation?.payBy ? `<div class="trip-details">${icon('clock')}결제 기한 ${esc(kTime(trip.reservation.payBy))}</div>` : ''}
    <div class="trip-actions"><button class="small-button ${trip.watchRequested ? '' : 'request'}" data-action="watch" data-id="${trip.id}" ${['expired', 'reserved', 'uncertain'].includes(status.code) ? 'disabled' : ''}>${trip.watchRequested ? '요청 해제' : '감시 요청 저장'}</button><span class="spacer"></span><button class="small-button" data-action="edit" data-id="${trip.id}">수정</button><button class="icon-button" data-action="copy" data-id="${trip.id}" aria-label="${esc(trip.name)} 복사">${icon('copy')}</button><button class="icon-button" data-action="delete" data-id="${trip.id}" aria-label="${esc(trip.name)} 삭제">${icon('trash')}</button></div>
  </article>`;
}
function renderTrips() {
  const upcoming = state.trips.filter(trip => !['expired', 'reserved'].includes(trip.status.code));
  const requested = upcoming.filter(trip => trip.watchRequested).length;
  const trips = [...state.trips].filter(trip => filter === 'all' || (filter === 'requested' && trip.watchRequested && ['blocked','watching','available'].includes(trip.status.code)) || (filter === 'paused' && trip.status.code === 'paused') || (filter === 'ended' && ['reserved', 'expired'].includes(trip.status.code))).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return `<div class="stats"><div class="stat"><div><p>등록한 여행</p><strong>${state.trips.length}<small>개</small></strong></div><span class="stat-icon">${icon('ticket')}</span></div><div class="stat"><div><p>확인 요청한 여행</p><strong>${requested}<small>개</small></strong></div><span class="stat-icon">${icon('clock')}</span></div><div class="stat"><div><p>알림 등록 기기</p><strong>${state.push.devices.length}<small>대</small></strong></div><span class="stat-icon">${icon('bell')}</span></div></div>
    <div class="workspace"><div><div class="section-heading"><h2>여행 목록<small>${state.trips.length}</small></h2><button class="text-button" data-action="export">${icon('download')}백업 저장</button></div>
    <div class="filters">${[['all', '전체'], ['requested', '확인 요청'], ['paused', '일시정지'], ['ended', '종료']].map(([key, name]) => `<button class="filter ${filter === key ? 'active' : ''}" data-filter="${key}" aria-pressed="${filter === key}">${name}</button>`).join('')}</div>
    <div class="trip-list">${trips.length ? trips.map(tripCard).join('') : `<div class="empty-state"><div class="empty-art"><img src="/icon.svg" alt=""></div><h3>${state.trips.length ? '이 조건의 여행이 없어요' : '다음 여행을 등록해 볼까요?'}</h3><p>${state.trips.length ? '다른 필터를 선택하거나 새 여행을 추가해 주세요.' : '날짜와 후보 열차, 함께 가는 인원을 정해요.<br>여행마다 원하는 조건을 따로 저장할 수 있어요.'}</p><button class="button outline" data-action="new">${icon('plus')}여행 추가</button></div>`}</div></div>
    <aside class="side-stack">${setupMarkup()}<div class="side-card"><h2>최근 활동</h2>${activityMarkup()}</div></aside></div>`;
}
function renderNotifications() {
  const capable = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return `<div class="settings-grid"><section class="panel"><h2>내 기기로 받는 자체 알림</h2><p>기기를 각각 등록하면 PC에서 브라우저 푸시를 보낼 수 있어요. 지금은 테스트 알림만 사용할 수 있고, 실제 예약 알림은 코레일 연동 후 사용할 수 있어요.</p>
    <form id="contact-form" class="inline-form"><div><label for="contact-email">알림 서비스에 전달할 연락용 이메일</label><input id="contact-email" type="email" required maxlength="160" value="${esc(state.push.contact)}" placeholder="you@example.com"></div><button class="button outline" type="submit">저장</button></form>
    <label for="device-name">이 기기 이름</label><input id="device-name" maxlength="40" value="${/iPhone|iPad/.test(navigator.userAgent) ? '내 아이폰' : /Android/.test(navigator.userAgent) ? '내 안드로이드' : '내 PC'}">
    <div class="install-hint">아이폰에서는 Safari로 접속해 <strong>공유 · 홈 화면에 추가</strong>한 다음, 홈 화면 아이콘으로 앱을 열고 알림을 허용해 주세요. 휴대폰에서는 신뢰할 수 있는 HTTPS 주소가 필요해요.</div>
    <div class="section-heading"><button class="button primary" data-action="subscribe" ${!capable || pushBusy ? 'disabled' : ''}>${icon('bell')}이 기기 알림 등록</button><button class="button outline" data-action="test-push" ${!state.push.devices.length || pushBusy ? 'disabled' : ''}>테스트 알림</button></div>
    ${!capable ? '<p class="small">현재 브라우저 또는 접속 주소에서는 푸시 등록을 지원하지 않아요. 지원 브라우저·HTTPS·아이폰 홈 화면 설치 여부를 확인해 주세요.</p>' : '<p class="small">전송 요청 성공과 실제 수신은 달라요. 테스트 후 잠금 화면이나 알림 센터에서 수신을 확인해 주세요.</p>'}
    <hr><h3>등록된 기기</h3><div class="device-list">${state.push.devices.length ? state.push.devices.map(device => `<div class="device-row">${icon('bell')}<div><strong>${esc(device.name)}</strong><p>${esc(kTime(device.createdAt))} 등록</p></div><button class="small-button" data-action="remove-device" data-id="${device.id}">해제</button></div>`).join('') : '<p class="small">아직 등록한 알림 기기가 없어요.</p>'}</div>
    </section><aside class="panel"><h2>어떤 소식을 받나요?</h2><ol><li><strong>특실 예약 확보</strong><br>예약내역에서 성공을 확인한 뒤 안내할 예정이에요.</li><li><strong>결제 기한</strong><br>예약에서 받은 실제 결제 기한을 알려줄 예정이에요.</li><li><strong>직접 확인이 필요한 상황</strong><br>재로그인이나 예약 결과 확인이 필요할 때 알려줄 예정이에요.</li></ol><p class="panel-note">위 예약 관련 알림은 아직 연결되지 않았어요. 현재는 기기 등록과 테스트 전송 기능을 제공합니다.</p></aside></div>`;
}
function renderConnection() {
  const c = state.connection, mesh = c.meshInterfaces, remoteReady = c.httpsConfigured && c.publicOrigin;
  return `<div class="settings-grid"><section class="panel"><h2>기존 Chrome 연결</h2><p>평소 쓰는 Chrome의 코레일 조회 결과를 읽는 연결 모듈이에요. 로그인 정보나 쿠키를 복사하지 않아요. 실제 확장프로그램 설치 후 동작 확인이 필요해요.</p><div class="status-list"><div class="status-line"><strong>Chrome 연결</strong><span class="${c.chrome?.live ? 'ready' : 'pending'}">${c.chrome?.live ? '최근 화면 결과 수신' : c.chrome?.paired ? '등록됨 · 조회 결과 대기' : '확장프로그램 연결 필요'}</span></div><div class="status-line"><strong>마지막 화면 확인</strong><span>${c.chrome?.lastSeen ? esc(kTime(c.chrome.lastSeen)) : '아직 없음'}</span></div><div class="status-line"><strong>자동 예약</strong><span class="pending">미연결 · 예약은 직접 진행</span></div></div><p class="small">배포 폴더의 chrome-extension을 Chrome에 설치한 뒤, 아래 코드로 연결해 주세요. 확장 설치와 사이트 접근 권한은 먼저 직접 확인해 주세요.</p><button class="button outline" data-action="chrome-code" ${!c.local ? 'disabled' : ''}>Chrome 연결 코드 만들기</button><div id="chrome-code-result"></div>${c.chrome?.paired ? '<button class="button ghost" data-action="chrome-disconnect">Chrome 연결 해제</button>' : ''}<p class="small">확장프로그램의 자동 새로고침을 켜면 일치하는 조회 결과 탭을 1분 간격으로 갱신해요. 자리 발견은 해당 인원 전체의 예약 가능 여부나 예약 확보를 보장하지 않아요. 휴대폰 알림 연결은 별도로 필요해요.</p></section><aside class="panel"><h2>Chrome에서 준비할 것</h2><ol><li>코레일에서 원하는 날짜·구간·인원으로 조회 결과를 열어 두세요.</li><li>PC 앱에 같은 날짜·구간·열차번호·시각의 여행을 저장하고 감시 요청을 켜 주세요.</li><li>확장프로그램에 연결 코드를 입력하고 ‘지금 상태 전달’을 눌러 주세요.</li><li>정확한 열차 상태 수신을 확인한 뒤 확장프로그램에서 자동 새로고침을 켜 주세요.</li></ol><p class="small">조회 제한이나 화면 해석 오류를 감지하면 자동 새로고침을 끕니다. 계정 접근과 자동 예약 기능은 포함하지 않아요.</p></aside><section class="panel"><h2>지금 연결 상태</h2><p>PC 실행, 코레일 연동, 휴대폰 보안 접속을 각각 확인해요.</p><div class="status-list">
    <div class="status-line"><strong>PC 앱</strong><span class="ready">연결됨 · <span id="heartbeat-time">${esc(kTime(c.serverTime))}</span></span></div>
    <div class="status-line"><strong>코레일 자동 예약</strong><span class="pending">미연결</span></div>
    <div class="status-line"><strong>기존 연결 도구</strong><span>${c.nordInstalled ? 'NordVPN 설치 확인' : 'NordVPN 설치 경로 미확인'}</span></div>
    <div class="status-line"><strong>Meshnet 네트워크 주소</strong><span>${mesh.length ? mesh.map(item => esc(item.address)).join('<br>') : '이름이 일치하는 주소를 찾지 못했어요'}</span></div>
    <div class="status-line"><strong>보안 접속 주소</strong><span class="${remoteReady ? 'ready' : 'pending'}">${remoteReady ? esc(c.publicOrigin) : 'HTTPS 설정 필요'}</span></div>
    <div class="status-line"><strong>알림 기기</strong><span>${state.push.devices.length}대 등록 · 수신 테스트 필요</span></div></div>
    <h3>휴대폰 연결 코드</h3><p class="small">보안 접속 준비가 끝나면 PC에서 코드를 만들고, 휴대폰 앱에서 입력해요. 코드는 10분 동안 한 번만 사용할 수 있어요.</p><button class="button outline" data-action="pair-code" ${!remoteReady || !c.local ? 'disabled' : ''}>연결 코드 만들기</button><div id="pair-result"></div>
    </section><aside class="panel"><h2>기존 NordVPN으로 연결하기</h2><ol><li>PC와 휴대폰의 NordVPN에서 Meshnet을 켜고, 본인 기기끼리 연결해요.</li><li>휴대폰에서 PC에 접근할 수 있도록 해당 기기의 원격 접근 권한을 확인해요.</li><li>휴대폰이 신뢰하는 HTTPS 접속 주소를 준비해요. Meshnet 연결만으로 브라우저 푸시 조건이 충족되지는 않아요.</li><li>휴대폰에서 앱을 열고 연결한 뒤, 알림을 등록하고 수신을 테스트해요.</li></ol><a class="guide-link" href="https://meshnet.nordvpn.com/how-to/joint-projects/nginx-web-server-access" target="_blank" rel="noopener noreferrer">NordVPN의 웹 접속 안내</a></aside>
    <section class="panel"><h2>예약 연동 확인 결과</h2><p>공개 열차 정보는 시간표 조회용이며, 개인용 앱에서 바로 쓸 수 있는 특실 잔여석·예약 API는 확인하지 못했어요. 기존 Chrome에서 열차 조회에 성공해, 화면 결과를 읽는 연결 모듈을 추가했습니다.</p><p>확장프로그램 설치 후 실제 연결 확인이 필요합니다. 서버가 코레일 로그인이나 자동 예약을 실행하지는 않습니다.</p><a class="guide-link" href="https://www.data.go.kr/data/15098552/openapi.do" target="_blank" rel="noopener noreferrer">공공 열차 API 범위</a><br><a class="guide-link" href="https://info.korail.com/info/selectBbsNttView.do?bbsNo=199&key=911&nttNo=24285" target="_blank" rel="noopener noreferrer">코레일 공식 판매 연계 안내</a></section>
    <section class="panel"><h2>여행 설정 백업</h2><p>백업 파일에는 여행 조건만 포함돼요. 알림 키와 기기 연결 정보는 포함하지 않아요. 가져온 여행은 일시정지 상태로 추가돼요.</p><div class="section-heading"><button class="button outline" data-action="export">백업 저장</button><button class="button outline" data-action="import">백업 가져오기</button></div><p class="small">원본 여행은 유지됩니다. 같은 백업을 다시 가져오면 여행이 추가로 생성됩니다.</p></section></div>`;
}
function render() {
  if (!state) return;
  const current = route();
  const names = { trips: ['YOUR NEXT JOURNEY', '내 여행', '여행마다 다른 조건으로, 원하는 특실을 준비해요.'], notifications: ['STAY IN THE KNOW', '알림', '밖에서도 내 기기로 소식을 받을 준비를 해요.'], connection: ['CONNECTED TO YOUR PC', '기기 연결', '내 PC와 휴대폰의 연결 상태를 확인해요.'] };
  $('#page-eyebrow').textContent = names[current][0]; $('#page-title').textContent = names[current][1]; $('#page-description').textContent = names[current][2];
  document.title = `특실로 · ${names[current][1]}`;
  $('.integration-notice strong').textContent = state.connection.chrome?.live ? '기존 Chrome에서 화면 결과를 받고 있어요' : '기존 Chrome 연결이 필요해요';
  $('.integration-notice p').textContent = 'Chrome 연결 후 특실 상태를 확인할 수 있어요. 자동 예약은 아직 연결되지 않았고, 자리 발견 후 예약은 직접 진행해야 해요.';
  $$('[data-nav]').forEach(el => { el.classList.toggle('active', el.dataset.nav === current); el.setAttribute('aria-current', el.dataset.nav === current ? 'page' : 'false'); });
  $('#view').innerHTML = current === 'trips' ? renderTrips() : current === 'notifications' ? renderNotifications() : renderConnection();
}
function addTrain(train = { number: '', time: '' }) {
  if ($$('.train-field').length >= 20) return toast('후보 열차는 최대 20개까지 등록할 수 있어요.');
  const index = crypto.randomUUID();
  $('#train-fields').insertAdjacentHTML('beforeend', `<div class="train-field"><div><label for="number-${index}">열차번호</label><input id="number-${index}" data-train="number" inputmode="numeric" pattern="[0-9]{1,5}" maxlength="5" placeholder="예: 001" value="${esc(train.number)}" required></div><div><label for="time-${index}">출발 시각</label><input id="time-${index}" data-train="time" type="time" value="${esc(train.time)}" required></div><button type="button" class="icon-button" data-action="remove-train" aria-label="이 후보 열차 삭제">×</button></div>`);
}
function updatePassengers() {
  const total = ['adult', 'child', 'senior'].reduce((sum, name) => sum + Number(form.elements[name].value || 0), 0);
  $('#passenger-total').textContent = `총 ${total}명`;
  $$('[data-step]').forEach(button => {
    const [name, delta] = button.dataset.step.split(':');
    button.disabled = Number(delta) < 0 ? Number(form.elements[name].value) <= 0 : total >= 9 || Number(form.elements[name].value) >= 9;
  });
}
function openTrip(trip = null, copy = false) {
  if (!online) return toast('PC 연결 상태를 먼저 확인해 주세요.');
  editingId = copy ? null : trip?.id || null; form.reset(); $('#form-error').textContent = '';
  $('#dialog-title').textContent = editingId ? '여행 설정 수정' : copy ? '여행 복사' : '새 여행 추가';
  form.elements.date.value = trip?.date || today();
  for (const name of ['name', 'from', 'to', 'seatPolicy', 'adjacency', 'existingTicket', 'notes']) if (trip) form.elements[name].value = trip[name];
  if (copy) form.elements.name.value = `${trip.name} 복사`.slice(0, 60);
  form.elements.watchRequested.checked = trip ? !copy && trip.watchRequested : true;
  if (trip) {
    for (const name of ['adult', 'child', 'senior']) form.elements[name].value = trip.passengers[name];
    form.elements.deadline.value = !copy && trip.deadlineMode === 'custom' ? toKoreaInput(trip.deadline) : '';
  }
  $('#train-fields').innerHTML = ''; (trip?.trains || [{ number: '', time: '' }]).forEach(addTrain); updatePassengers();
  $('#trip-dialog').showModal(); $('.dialog-body').scrollTop = 0;
}
async function subscribe() {
  if (pushBusy) return;
  if (!state.push.contact) return toast('연락용 이메일을 먼저 저장해 주세요.');
  if (!window.isSecureContext || !('Notification' in window)) return toast('알림을 지원하는 보안 접속 주소에서 열어 주세요.');
  pushBusy = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('알림이 허용되지 않았어요. 기기 설정에서 알림 권한을 확인해 주세요.');
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    const padded = state.push.publicKey.replace(/-/g, '+').replace(/_/g, '/');
    const applicationServerKey = Uint8Array.from(atob(padded + '='.repeat((4 - padded.length % 4) % 4)), char => char.charCodeAt(0));
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    await api('/push/subscription', { method: 'POST', body: { subscription: subscription.toJSON(), name: $('#device-name').value } });
    await refresh(true); toast('기기를 등록했어요. 테스트 알림으로 수신을 확인해 주세요.');
  } finally { pushBusy = false; }
}
async function exportTrips() {
  const data = await api('/export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `특실로-여행백업-${today()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
document.addEventListener('click', async event => {
  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) { filter = filterButton.dataset.filter; render(); return; }
  const step = event.target.closest('[data-step]');
  if (step) { const [name, delta] = step.dataset.step.split(':'); const el = form.elements[name]; el.value = Math.min(9, Math.max(0, Number(el.value || 0) + Number(delta))); updatePassengers(); return; }
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action, trip = state?.trips.find(item => item.id === button.dataset.id);
  try {
    if (action === 'new') openTrip();
    if (action === 'edit') openTrip(trip);
    if (action === 'copy') openTrip(trip, true);
    if (action === 'close-dialog') $('#trip-dialog').close();
    if (action === 'add-train') addTrain();
    if (action === 'remove-train') { if ($$('.train-field').length <= 1) toast('후보 열차는 하나 이상 필요해요.'); else button.closest('.train-field').remove(); }
    if (action === 'swap') { const old = form.elements.from.value; form.elements.from.value = form.elements.to.value; form.elements.to.value = old; }
    if (action === 'watch') { await api(`/trips/${trip.id}/watch`, { method: 'POST', body: { enabled: !trip.watchRequested } }); await refresh(true); toast(trip.watchRequested ? '감시 요청을 해제했어요.' : '요청을 저장했어요. Chrome 연결과 일치하는 조회 결과 탭이 필요해요.'); }
    if (action === 'delete') { deletingId = trip.id; $('#confirm-dialog').showModal(); }
    if (action === 'cancel-delete') { deletingId = null; $('#confirm-dialog').close(); }
    if (action === 'confirm-delete' && deletingId) { await api(`/trips/${deletingId}`, { method: 'DELETE', body: {} }); deletingId = null; $('#confirm-dialog').close(); await refresh(true); toast('여행 설정을 삭제했어요.'); }
    if (action === 'subscribe') await subscribe();
    if (action === 'test-push') { button.disabled = true; const result = await api('/push/test', { method: 'POST', body: {} }); await refresh(true); toast(`${result.accepted}대의 알림 서비스에 전송을 요청했어요. 기기에서 실제 수신을 확인해 주세요.`); }
    if (action === 'remove-device') { await api(`/push/devices/${button.dataset.id}`, { method: 'DELETE', body: {} }); await refresh(true); toast('이 기기로의 알림 전송을 해제했어요.'); }
    if (action === 'pair-code') { const result = await api('/pair-code', { method: 'POST', body: {} }); $('#pair-result').innerHTML = `<p class="small">휴대폰에서 <strong>${esc(result.origin)}</strong>에 접속한 뒤 입력해 주세요.</p><div class="code-box">${esc(result.code)}</div><p class="small">${esc(kTime(result.expiresAt))}까지 · 1회용</p>`; }
    if (action === 'chrome-code') { const result = await api('/chrome/code', { method:'POST', body:{} }); $('#chrome-code-result').innerHTML = `<div class="code-box">${esc(result.code)}</div><p class="small">${esc(kTime(result.expiresAt))}까지 · 확장프로그램 팝업에 입력해 주세요.</p>`; }
    if (action === 'chrome-disconnect') { await api('/chrome/disconnect', {method:'POST',body:{}}); await refresh(true); toast('Chrome 연결을 해제했어요.'); }
    if (action === 'export') await exportTrips();
    if (action === 'import') $('#import-file').click();
  } catch (error) { toast(error.message || '처리 중 오류가 생겼어요.'); }
  finally { if (button.isConnected && action === 'test-push') button.disabled = false; }
});
form.addEventListener('input', event => { if (['adult', 'child', 'senior'].includes(event.target.name)) updatePassengers(); });
form.addEventListener('submit', async event => {
  event.preventDefault(); $('#save-trip').disabled = true; $('#form-error').textContent = '';
  try {
    const values = Object.fromEntries(new FormData(form));
    const payload = { ...values, passengers: Object.fromEntries(['adult', 'child', 'senior'].map(name => [name, Number(values[name])])), trains: $$('.train-field').map(el => ({ number: $('[data-train="number"]', el).value, time: $('[data-train="time"]', el).value })), deadline: values.deadline ? new Date(`${values.deadline}:00+09:00`).toISOString() : null, watchRequested: form.elements.watchRequested.checked };
    await api(editingId ? `/trips/${editingId}` : '/trips', { method: editingId ? 'PUT' : 'POST', body: payload });
    $('#trip-dialog').close(); location.hash = 'trips'; await refresh(true); toast('여행을 저장했어요. 상태 확인은 Chrome 연결 후 가능하고 자동 예약은 미연결이에요.');
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { $('#save-trip').disabled = false; }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'contact-form') return;
  event.preventDefault();
  try { await api('/push/contact', { method: 'POST', body: { email: $('#contact-email').value } }); await refresh(true); toast('연락용 이메일을 저장했어요.'); } catch (error) { toast(error.message); }
});
$('#pair-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#pair-error').textContent = '';
  try { await api('/pair', { method: 'POST', body: { code: $('#pair-code').value.trim() } }); $('#pair-code').value = ''; await refresh(true); } catch (error) { $('#pair-error').textContent = error.message; }
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 262144) throw new Error('백업 파일은 256KB 이하로 선택해 주세요.'); const result = await api('/import', { method: 'POST', body: JSON.parse(await file.text()) }); await refresh(true); toast(`${result.count}개 여행을 일시정지 상태로 가져왔어요.`); }
  catch (error) { toast(error instanceof SyntaxError ? 'JSON 백업 파일을 읽을 수 없어요.' : error.message); }
  finally { event.target.value = ''; }
});
window.addEventListener('hashchange', render);
window.addEventListener('online', () => refresh(true));
window.addEventListener('offline', () => markOnline(false));
fillIcons();
try { await api('/local-session', { method: 'POST', body: {} }); } catch { /* Remote devices must pair over HTTPS. */ }
await refresh(true);
if (window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
setInterval(() => refresh(false), 15000);
