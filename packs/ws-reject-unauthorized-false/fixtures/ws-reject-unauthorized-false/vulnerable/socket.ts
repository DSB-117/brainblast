import WebSocket from "ws";

export function connectFeed(url: string) {
  // VULNERABLE: rejectUnauthorized: false disables TLS validation — the wss connection can be MITM'd.
  return new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 });
}
