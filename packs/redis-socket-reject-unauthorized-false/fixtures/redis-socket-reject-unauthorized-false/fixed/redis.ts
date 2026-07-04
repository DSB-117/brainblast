import { createClient } from "redis";

export function makeRedis(url: string, ca: string) {
  // FIXED: certificate validation enforced; trust the provider's CA explicitly.
  return createClient({ url, socket: { tls: true, rejectUnauthorized: true, ca } });
}
