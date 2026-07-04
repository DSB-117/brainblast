import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";

export function makeIo(httpServer: HttpServer) {
  // FIXED: only the trusted front-end origin may open a socket.
  return new Server(httpServer, { cors: { origin: "https://app.example.com", credentials: true } });
}
