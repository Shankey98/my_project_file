/**
 * One-shot Google-server diagnostic, not a watcher or reservation service.
 * No credentials, cookies, anti-bot tokens, retries, or scheduled triggers.
 */
function probeKorailServer() {
  var target = { date: '20261205', time: '083500', from: '서울', to: '포항', train: '259', adults: 1 };
  var departure = target.date.slice(0, 4) + '-' + target.date.slice(4, 6) + '-' + target.date.slice(6, 8)
    + 'T' + target.time.slice(0, 2) + ':' + target.time.slice(2, 4) + ':' + target.time.slice(4, 6) + '+09:00';
  if (!isFinite(Date.parse(departure)) || Date.now() >= Date.parse(departure)) {
    throw new Error('테스트 대상의 출발 시각이 지났거나 올바르지 않습니다. target을 변경하세요.');
  }
  var report = {
    checkedAt: new Date().toISOString(), runtime: 'Google Apps Script',
    target: target, seatLookupVerified: false, automaticReservation: false
  };
  // This checks HTTP access only. A 200 HTML shell is NOT a seat result.
  report.web = fetchDiagnostic_('https://www.korail.com/ticket/search/general', false, target);
  // Read-only web request schema observed in the current official public bundle.
  // No browser verification tokens are generated or copied.
  var query = {
    Device: 'BH', Version: '999999999', radJobId: '1', selGoTrain: '109',
    txtCardPsgCnt: '0', txtGdNo: '', txtGoAbrdDt: target.date,
    txtGoEnd: target.to, txtGoHour: target.time, txtGoStart: target.from,
    txtJobDv: '', txtMenuId: '11', txtPsgFlg_1: String(target.adults),
    txtPsgFlg_2: '0', txtPsgFlg_3: '0', txtPsgFlg_4: '0', txtPsgFlg_5: '0',
    txtPsgFlg_8: '0', txtSeatAttCd_2: '000', txtSeatAttCd_3: '000',
    txtSeatAttCd_4: '015', txtTrnGpCd: '109', tkTripChgQryFlg: 'Y',
    adjStnScdlOfrFlg: 'N', adjStnScdlOfrFlg2: 'N', srtCheckYn: 'N',
    ebizCrossCheck: 'N', rtYn: 'N', txtWkndUseFlg: 'Y'
  };
  var url = 'https://www.korail.com/classes/com.korail.mobile.seatMovie.ScheduleView';
  report.webQuery = fetchDiagnostic_(url, true, target, { method: 'post', payload: query });
  report.seatLookupVerified = report.webQuery.result === 'TARGET_OBSERVED';
  // Save/log only the allowlisted diagnostic, never response bodies or headers.
  PropertiesService.getScriptProperties().setProperty('LAST_PROBE_REPORT', JSON.stringify(report));
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function fetchDiagnostic_(url, isSeatQuery, target, requestOptions) {
  var started = Date.now();
  try {
    var options = Object.assign({}, requestOptions || {}, {
      method: requestOptions && requestOptions.method || 'get', followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true
    });
    var response = UrlFetchApp.fetch(url, options);
    var status = response.getResponseCode();
    var body = response.getContentText();
    var result = { httpStatus: status, elapsedMs: Date.now() - started, bytes: response.getContent().length };
    if (status >= 300 && status < 400) { result.result = 'REDIRECT_NOT_FOLLOWED'; return result; }
    if (status < 200 || status >= 300) { result.result = 'HTTP_ERROR'; return result; }
    if (!isSeatQuery) { result.result = 'HTTP_ONLY_NO_SEAT_VERIFICATION'; return result; }
    var data;
    try { data = JSON.parse(body); } catch (_) { result.result = 'NON_JSON_NO_SEAT_DATA'; return result; }
    result.protocol = protocolDiagnostic_(data);
    // Only short protocol codes are logged. Upstream text may contain private data.
    if (data && typeof data.h_msg_cd === 'string' && /^[A-Za-z0-9_ -]{1,64}$/.test(data.h_msg_cd)) result.upstreamCode = data.h_msg_cd.trim();
    // Only recognize generic public update instructions; arbitrary messages stay private.
    if (data && data.strResult === 'FAIL' && typeof data.h_msg_txt === 'string'
        && /^[가-힣\s.,!()·\-]+$/.test(data.h_msg_txt) && data.h_msg_txt.length <= 300
        && /최신\s*버전/.test(data.h_msg_txt) && /업데이트/.test(data.h_msg_txt)) {
      result.genericFailureMessage = data.h_msg_txt;
    }
    if (!data || data.strResult !== 'SUCC') {
      result.result = result.protocol.messageKinds.indexOf('ACCESS_RESTRICTION') >= 0 ? 'ACCESS_RESTRICTED' : 'UPSTREAM_REJECTED_OR_UNKNOWN';
      return result;
    }
    var rows = data.trn_infos && data.trn_infos.trn_info;
    if (!Array.isArray(rows)) { result.result = 'SCHEMA_UNRECOGNIZED'; return result; }
    var matches = rows.filter(function(row) {
      return row && /^\d{1,5}$/.test(String(row.h_trn_no)) && Number(row.h_trn_no) === Number(target.train)
        && row.h_dpt_dt === target.date && row.h_dpt_tm === target.time
        && row.h_dpt_rs_stn_nm === target.from && row.h_arv_rs_stn_nm === target.to;
    });
    if (matches.length !== 1) { result.result = 'TARGET_NOT_VERIFIED'; return result; }
    var code = matches[0].h_spe_rsv_cd;
    if (['00', '11', '13'].indexOf(code) < 0) { result.result = 'SEAT_SCHEMA_UNRECOGNIZED'; return result; }
    result.result = 'TARGET_OBSERVED';
    result.specialClassCode = code;
    result.specialClass = { '00': '없음', '11': '예약 가능 표시', '13': '매진 표시' }[code];
    result.reservationHeld = false;
    return result;
  } catch (_) {
    // Exception messages may include request URLs. Do not log them.
    return { result: 'FETCH_EXCEPTION', elapsedMs: Date.now() - started };
  }
}

/** Log schema and short machine codes; never log upstream messages or tokens. */
function protocolDiagnostic_(data) {
  var summary = { rootKeys: [], codes: [], messageKinds: [] };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return summary;
  summary.rootKeys = Object.keys(data).filter(function(k) { return /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k); }).slice(0, 20);
  function visit(value, path, depth) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return;
    Object.keys(value).slice(0, 25).forEach(function(key) {
      var field = value[key];
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key)) return;
      var next = path ? path + '.' + key : key;
      if (/^(code|resultcode|errorcode|status|strresult|h_msg_cd|msgcd|msgcode|result)$/i.test(key)
          && (typeof field === 'string' || typeof field === 'number')
          && /^[A-Za-z0-9_. -]{1,64}$/.test(String(field)) && summary.codes.length < 12) {
        summary.codes.push({ field: next, value: String(field) });
      }
      if (/^(message|msg|h_msg_txt|errormessage|msgtext)$/i.test(key) && typeof field === 'string') {
        var kind = /매크로|자동화|비정상|차단|unauthorized|forbidden|bot/i.test(field) ? 'ACCESS_RESTRICTION'
          : /로그인|login|authentication/i.test(field) ? 'AUTH_REQUIRED'
          : /버전|업데이트|version|update/i.test(field) ? 'VERSION_RELATED'
          : /파라미터|매개|입력|parameter|invalid/i.test(field) ? 'REQUEST_RELATED' : 'OTHER_MESSAGE';
        if (summary.messageKinds.indexOf(kind) < 0) summary.messageKinds.push(kind);
      }
      visit(field, next, depth + 1);
    });
  }
  visit(data, '', 0);
  if (data.h_msg_cd === 'MACRO ERROR') summary.messageKinds = ['ACCESS_RESTRICTION'];
  return summary;
}

/** Separate, explicit test. Set SLACK_WEBHOOK_URL in project Script properties. */
function testSlack() {
  var hook = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL') || '';
  if (!/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(hook)) {
    throw new Error('프로젝트 설정 → 스크립트 속성에 SLACK_WEBHOOK_URL을 등록하세요. URL은 채팅에 보내지 마세요.');
  }
  var response;
  try {
    response = UrlFetchApp.fetch(hook, {
      method: 'post', contentType: 'application/json', followRedirects: false,
      muteHttpExceptions: true, validateHttpsCertificates: true,
      payload: JSON.stringify({ text: '🚆 특실로 · Google 서버 → Slack 전송 테스트입니다. 아직 상시 감시나 예약은 시작되지 않았습니다.' })
    });
  } catch (_) { throw new Error('Slack 전송 중 통신 오류가 발생했습니다. 재전송 전 채널을 확인하세요.'); }
  if (response.getResponseCode() !== 200 || response.getContentText().trim() !== 'ok') {
    throw new Error('Slack이 테스트 메시지를 수락하지 않았습니다. HTTP ' + response.getResponseCode());
  }
  console.log('Slack 접수 성공. 휴대폰의 실제 알림 수신은 별도로 확인하세요.');
}
