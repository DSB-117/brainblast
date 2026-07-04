import puppeteer from "puppeteer";

export async function launchScraper() {
  // VULNERABLE: ignoreHTTPSErrors accepts any certificate — the scrape can be silently MITM'd.
  const browser = await puppeteer.launch({ headless: true, ignoreHTTPSErrors: true });
  return browser;
}
