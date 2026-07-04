import Redis from "ioredis";

export function makeRedis(host: string, port: number) {
  // VULNERABLE: tls.rejectUnauthorized: false — the Redis server certificate is not validated.
  return new Redis({ host, port, tls: { rejectUnauthorized: false } });
}
