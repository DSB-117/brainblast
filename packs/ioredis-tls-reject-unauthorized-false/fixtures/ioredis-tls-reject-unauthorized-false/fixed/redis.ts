import Redis from "ioredis";

export function makeRedis(host: string, port: number, ca: string) {
  // FIXED: certificate validation enforced; trust the provider's CA explicitly.
  return new Redis({ host, port, tls: { rejectUnauthorized: true, ca } });
}
