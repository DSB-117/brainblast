import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";

export function makeIo(httpServer: HttpServer) {
  // VULNERABLE: cors.origin "*" lets any site open an authenticated socket to the API.
  return new Server(httpServer, { cors: { origin: "*", credentials: true } });
}
