export function offsetFor(page: number, pageSize: number): number {
  // VULNERABLE: pages are 1-indexed, so page 1 should map to offset 0. Multiplying
  // page * pageSize skips the entire first page — every listing silently omits its
  // first `pageSize` records (and shifts all boundaries by one page).
  return page * pageSize;
}
