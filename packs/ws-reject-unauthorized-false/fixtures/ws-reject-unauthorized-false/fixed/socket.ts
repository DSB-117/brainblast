import WebSocket from "ws";

export function connectFeed(url: string) {
  // FIXED: certificate validation enforced on the wss connection.
  return new WebSocket(url, { rejectUnauthorized: true, handshakeTimeout: 5000 });
}
