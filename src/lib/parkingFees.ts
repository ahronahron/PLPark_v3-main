export function calculateBillableHours(
  entryTime: string | Date,
  endTime: string | Date | number = Date.now(),
  gracePeriodMinutes = 0,
): number {
  const start = new Date(entryTime).getTime();
  const end = typeof endTime === 'number' ? endTime : new Date(endTime).getTime();
  const graceMs = Math.max(0, gracePeriodMinutes) * 60_000;
  const billableMs = Math.max(0, end - start - graceMs);
  if (billableMs <= 0) return 0;
  return Math.max(0.5, Math.ceil((billableMs / 3_600_000) * 2) / 2);
}

export function calculateParkingFee(durationHours: number, hourlyRate: number): number {
  return Math.round(durationHours * hourlyRate * 100) / 100;
}
