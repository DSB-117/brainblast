import session from "koa-session";
import type Koa from "koa";

export function useSession(app: Koa) {
  // VULNERABLE: secure: false sends the session cookie over plain HTTP — it can be sniffed.
  app.use(session({ key: "koa.sess", secure: false, httpOnly: true }, app));
  return app;
}
