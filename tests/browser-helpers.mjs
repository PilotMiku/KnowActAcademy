import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

export { chromium };
export const baseURL =
  process.env.LOCAL_NEUMATHE_URL || "http://127.0.0.1:4178";
const systemChrome =
  process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined;
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (systemChrome && existsSync(systemChrome) ? systemChrome : undefined);
export const browserOptions = {
  headless: true,
  ...(executablePath ? { executablePath } : {}),
};
await mkdir("artifacts", { recursive: true });

export async function revealPracticeOptions(page) {
  const options = page.locator('.practice-options');
  await options.waitFor({ state: 'attached' });
  if (!await options.evaluate(el => el.open))
    await options.locator(':scope > summary').click();
}

export async function revealPreparationOptions(page) {
  const options = page.locator('.preparation-options');
  await options.waitFor({ state: 'attached' });
  if (!await options.evaluate(el => el.open)) await options.locator(':scope > summary').click();
}
