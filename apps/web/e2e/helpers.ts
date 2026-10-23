import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { totp } from "./totp.ts";

export const PASSWORD = "correct horse battery staple";
export const SHOTS = "test-results/screens";

export async function axe(page: Page, label: string) {
  // Scan the settled page, not a frame halfway through a fade-in (dialogs, menus):
  // a partly transparent button reads as low contrast.
  // Looping animations (spinners) never finish, so only wait for finite ones.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(summary, `axe on ${label}`).toEqual([]);
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** First sign-in for a seeded user: sets up two-step sign-in through the UI and lands on Today. */
export async function enrol(page: Page, email: string): Promise<{ secret: string; at: number }> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/setup-mfa$/);
  await page.getByLabel("Confirm your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Can't scan it? Enter this key instead").click();
  const secret = (await page.getByTestId("totp-secret").getAttribute("data-secret")) ?? "";
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  const at = left < 5 ? Date.now() + 6000 : Date.now();
  await page.getByLabel("6-digit code from the app").fill(totp(secret, at));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await page.getByLabel("I've saved my backup codes").check();
  await page.getByRole("button", { name: "Go to eMazeBrain" }).click();
  await expect(page).toHaveURL(/\/today$/);
  return { secret, at };
}
