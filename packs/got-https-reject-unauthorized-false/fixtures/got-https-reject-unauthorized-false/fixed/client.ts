import got from "got";

export function fetchSecret(url: string) {
  // FIXED: certificate validation enforced.
  return got(url, { https: { rejectUnauthorized: true }, timeout: { request: 5000 } });
}
