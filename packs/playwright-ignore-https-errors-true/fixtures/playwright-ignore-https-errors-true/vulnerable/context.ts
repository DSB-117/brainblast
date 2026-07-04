import { chromium, type Browser } from "playwright";

export async function openContext(browser: Browser) {
  // VULNERABLE: ignoreHTTPSErrors accepts any certificate — the context can be silently MITM'd.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  return context;
}
