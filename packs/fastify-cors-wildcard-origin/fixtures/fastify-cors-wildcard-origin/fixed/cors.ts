import Fastify from "fastify";
import cors from "@fastify/cors";

export async function buildServer() {
  const app = Fastify();
  // FIXED: only the trusted front-end origin may make cross-origin requests.
  await app.register(cors, { origin: "https://app.example.com", credentials: true });
  return app;
}
