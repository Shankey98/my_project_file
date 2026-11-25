// Provider contract is deliberately disconnected: no unofficial endpoints or credentials.
// This coordinator is exercised by tests only until a verified live provider exists.
export class ReservationCoordinator {
  #busy = new Set();
  constructor({ provider, save, notify, now = () => Date.now() }) {
    Object.assign(this, { provider, save, notify, now });
  }
  async tick(trip) {
    if (this.#busy.has(trip.id)) return 'busy';
    if (!trip.watchRequested || trip.reservation || Date.parse(trip.deadline) <= this.now()) return 'inactive';
    if (!this.provider?.capabilities?.canReserveSpecial) return 'disconnected';
    this.#busy.add(trip.id);
    try {
      const total = Object.values(trip.passengers).reduce((a, b) => a + b, 0);
      for (const train of trip.trains) {
        if (Date.parse(`${trip.date}T${train.time}:00+09:00`) <= this.now()) continue;
        const offer = await this.provider.findSpecial(trip, train);
        if (!offer || offer.count < (trip.seatPolicy === 'all' ? total : 1)) continue;
        // Provider must select passenger types explicitly for a partial reservation.
        // Never silently choose which person gets a ticket.
        if (trip.seatPolicy === 'partial' && offer.count < total) {
          await this.notify({ kind: 'partial', tripId: trip.id, message: '일부 인원 좌석만 있어 직접 확인이 필요합니다.' });
          return 'partial_confirmation';
        }
        // Persist an intent BEFORE touching the upstream reservation endpoint.
        // A crash or timeout leaves the trip stopped until reconciliation.
        trip.reservation = { status: 'uncertain', train, attemptedAt: new Date(this.now()).toISOString() };
        await this.save(trip);
        let confirmed;
        try {
          const attempt = await this.provider.reserveSpecial(trip, train, offer);
          confirmed = await this.provider.confirmReservation(attempt);
        } catch { confirmed = null; }
        if (!confirmed?.id || !confirmed.payBy || !Number.isFinite(Date.parse(confirmed.payBy)) || Date.parse(confirmed.payBy) <= this.now() || confirmed.seatClass !== 'special' || confirmed.trainNumber !== train.number || confirmed.date !== trip.date || confirmed.from !== trip.from || confirmed.to !== trip.to || confirmed.count !== total) {
          await this.notify({ kind: 'uncertain', tripId: trip.id, message: '예약 결과가 불확실합니다. 코레일 예약내역을 확인해 주세요.' });
          return 'uncertain';
        }
        trip.reservation = { status: 'confirmed', id: confirmed.id, payBy: confirmed.payBy, train, count: confirmed.count };
        trip.watchRequested = false;
        await this.save(trip);
        await this.notify({ kind: 'reserved', tripId: trip.id, message: '특실 예약이 확인되었습니다. 코레일에서 결제해 주세요.', payBy: confirmed.payBy });
        return 'reserved';
      }
      return 'unavailable';
    } finally { this.#busy.delete(trip.id); }
  }
}
