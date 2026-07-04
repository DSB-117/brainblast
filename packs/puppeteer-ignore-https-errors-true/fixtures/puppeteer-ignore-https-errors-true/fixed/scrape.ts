import puppeteer from "puppeteer";

export async function launchScraper() {
  // FIXED: TLS certificate validation enforced.
  const browser = await puppeteer.launch({ headless: true, ignoreHTTPSErrors: false });
  return browser;
}
