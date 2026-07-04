import got from "got";

export function fetchSecret(url: string) {
  // VULNERABLE: https.rejectUnauthorized: false disables TLS validation — the call can be MITM'd.
  return got(url, { https: { rejectUnauthorized: false }, timeout: { request: 5000 } });
}
