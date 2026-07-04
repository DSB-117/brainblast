export function offsetFor(page: number, pageSize: number): number {
  // FIXED: 1-indexed page → zero-based offset.
  return (page - 1) * pageSize;
}
