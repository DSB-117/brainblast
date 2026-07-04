import { chromium, type Browser } from "playwright";

export async function openContext(browser: Browser) {
  // FIXED: TLS certificate validation enforced for every page in the context.
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  return context;
}
