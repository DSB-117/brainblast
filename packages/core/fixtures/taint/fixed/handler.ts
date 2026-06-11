// FIXED: no secret-shaped env value reaches a logging/response sink.
export function debugHandler(req: unknown) {
  console.log("handler called");
  return { ok: true };
}
