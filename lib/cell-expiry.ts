// Legacy timestamp-without-time-zone values are UTC wall time.
export function cellExpiryTime(value: unknown): number {
  if (typeof value !== "string" || !value) return NaN;
  const withZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
  return Date.parse(withZone ? value : `${value}Z`);
}

export function isActiveCell(cell: { expires_at?: unknown } | null | undefined, now = Date.now()): boolean {
  return Boolean(cell && cellExpiryTime(cell.expires_at) > now);
}
