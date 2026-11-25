import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const text = (value, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const koreaToday = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const departureTime = (trip, train) => Date.parse(`${trip.date}T${train.time}:00+09:00`);
export function validateTrip(input, { now = Date.now(), id = randomUUID(), createdAt = new Date(now).toISOString(), allowPast = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('여행 정보를 확인해 주세요.');
  const name = text(input.name, 60), from = text(input.from, 30), to = text(input.to, 30);
  if (!name || !from || !to || from === to) throw new AppError('여행 이름과 서로 다른 출발·도착역을 입력해 주세요.');
  const date = text(input.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00+09:00`)) || koreaToday(Date.parse(`${date}T00:00:00+09:00`)) !== date) throw new AppError('올바른 여행 날짜를 입력해 주세요.');
  const passengers = {};
  for (const kind of ['adult', 'child', 'senior']) {
    const value = input.passengers?.[kind] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > 9) throw new AppError('승객 수는 종류별 0~9명으로 입력해 주세요.');
    passengers[kind] = value;
  }
  const total = Object.values(passengers).reduce((a, b) => a + b, 0);
  if (total < 1 || total > 9) throw new AppError('여행 인원은 총 1~9명으로 설정해 주세요.');
  if (!['all', 'partial'].includes(input.seatPolicy)) throw new AppError('좌석 확보 조건을 선택해 주세요.');
  if (!['prefer', 'any'].includes(input.adjacency)) throw new AppError('좌석 배치 조건을 선택해 주세요.');
  if (!Array.isArray(input.trains) || input.trains.length < 1 || input.trains.length > 20) throw new AppError('후보 열차를 1~20개 입력해 주세요.');
  const seen = new Set();
  const trains = input.trains.map((train) => {
    const number = text(train.number, 5), time = text(train.time, 5);
    if (!/^\d{1,5}$/.test(number) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new AppError('열차번호와 출발 시각을 확인해 주세요.');
    const key = String(Number(number));
    if (seen.has(key)) throw new AppError('같은 열차번호가 중복되어 있어요.');
    seen.add(key);
    return { number, time };
  });
  const maxDeparture = Math.max(...trains.map(train => departureTime({ date }, train)));
  if (!allowPast && maxDeparture <= now) throw new AppError('아직 출발하지 않은 후보 열차를 입력해 주세요.');
  const customDeadline = Boolean(input.deadline) && input.deadlineMode !== 'last-train';
  const deadline = customDeadline ? Date.parse(input.deadline) : maxDeparture;
  if (!Number.isFinite(deadline) || deadline > maxDeparture || (!allowPast && deadline <= now)) throw new AppError('감시 종료 시각은 현재 이후, 마지막 후보 열차 출발 이전으로 설정해 주세요.');
  const existingTicket = ['paid', 'unpaid', 'none'].includes(input.existingTicket) ? input.existingTicket : 'paid';
  return { id, name, from, to, date, passengers, seatPolicy: input.seatPolicy, adjacency: input.adjacency, trains, deadline: new Date(deadline).toISOString(), deadlineMode: customDeadline ? 'custom' : 'last-train', existingTicket, notes: text(input.notes, 500), watchRequested: Boolean(input.watchRequested), createdAt, updatedAt: new Date(now).toISOString(), reservation: null };
}

export function tripStatus(trip, now = Date.now()) {
  if (trip.reservation?.status === 'confirmed') return { code: 'reserved', label: '예약 확보' };
  if (trip.reservation?.status === 'uncertain') return { code: 'uncertain', label: '예약내역 확인 필요' };
  if (Date.parse(trip.deadline) <= now) return { code: 'expired', label: '종료 시각 지남' };
  return trip.watchRequested ? { code: 'blocked', label: '예약 연동 대기' } : { code: 'paused', label: '일시정지' };
}
