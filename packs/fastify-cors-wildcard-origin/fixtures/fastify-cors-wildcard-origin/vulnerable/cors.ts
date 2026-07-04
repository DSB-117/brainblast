import Fastify from "fastify";
import cors from "@fastify/cors";

export async function buildServer() {
  const app = Fastify();
  // VULNERABLE: origin "*" lets any site call the API — with credentials this is session-theft.
  await app.register(cors, { origin: "*", credentials: true });
  return app;
}
