import session from "koa-session";
import type Koa from "koa";

export function useSession(app: Koa) {
  // FIXED: secure: true — the session cookie is only sent over HTTPS.
  app.use(session({ key: "koa.sess", secure: true, httpOnly: true }, app));
  return app;
}
