export function isExpired(nowSeconds: number, expSeconds: number): boolean {
  // FIXED: compare like units — both in seconds.
  return nowSeconds >= expSeconds;
}
