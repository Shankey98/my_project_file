globalThis.KtxSpecialParse = function(rows, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('조회 날짜를 확인할 수 없습니다.');
  const result = [];
  const status = text => /^매진$/.test(text.trim()) ? 'soldout' : /특실|일반실/.test(text) && /[\d,]+원/.test(text) && !/예약대기/.test(text) ? 'available' : 'unknown';
  for (const row of rows) {
    const text = row.text.replace(/\s+/g, ' ').trim();
    const match = /^KTX(?:-(?:산천|이음|청룡))?\s*(\d{1,5})\s*(?:서대구정차\s*)?(.+?)\s*→\s*(.+?)\s*\(\s*(\d{2}:\d{2})\s*~\s*\d{2}:\d{2}\s*\)/.exec(text);
    if (!match || row.seats.length !== 2) continue;
    const train = {number: match[1], from: match[2].trim(), to: match[3].trim(), time: match[4], general: status(row.seats[0]), special: status(row.seats[1])};
    if (!result.some(item => item.number === train.number && item.time === train.time)) result.push(train);
  }
  if (!result.length) throw new Error('열차 결과를 읽지 못했습니다. 코레일의 조회 결과 화면을 열어 주세요.');
  return {date, trains: result};
};
