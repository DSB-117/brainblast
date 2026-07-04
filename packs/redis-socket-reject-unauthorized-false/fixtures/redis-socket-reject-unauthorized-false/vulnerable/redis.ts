import { createClient } from "redis";

export function makeRedis(url: string) {
  // VULNERABLE: socket.rejectUnauthorized: false — the Redis server certificate is not validated.
  return createClient({ url, socket: { tls: true, rejectUnauthorized: false } });
}
