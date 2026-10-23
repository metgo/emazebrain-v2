/**
 * The first clinic journey, end to end against a real API and database:
 * sign in → set up two-step sign-in → Today → Patients → one patient →
 * Hebrew (RTL) → tablet and phone layouts → sign out → sign in with a code.
 * Every screen is scanned with axe for WCAG 2.2 AA problems.
 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { totp } from "./totp.ts";

const EMAIL = "yael@synthetic.test";
const PASSWORD = "correct horse battery staple";
const SHOTS = "test-results/screens";

test.describe.configure({ mode: "serial" });

let secret = "";
let backupCodes: string[] = [];

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(summary, `axe on ${label}`).toEqual([]);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/**
 * Codes are single-use. Enrolment uses the current 30-second step; the one
 * later sign-in uses the next step (accepted thanks to ±1 step of drift).
 */
let enrolledAt = 0;
function enrolmentCode(): string {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  enrolledAt = left < 5 ? Date.now() + 6000 : Date.now();
  return totp(secret, enrolledAt);
}
const signInCode = () => totp(secret, enrolledAt + 30_000);
const STATE = "test-results/.signed-in.json";

test("deep link while signed out asks to sign in", async ({ page }) => {
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fpatients/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await axe(page, "sign-in");
  await shot(page, "01-sign-in");
});

test("wrong password is explained without saying which part was wrong", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("not the password at all");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match. Check them and try again.");
});

test("first sign-in sets up two-step sign-in, then lands on Today", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/setup-mfa$/);
  await expect(page.getByRole("heading", { level: 1, name: "Set up two-step sign-in" })).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await axe(page, "mfa step 1");
  await shot(page, "02-mfa-1-password");

  await page.getByLabel("Confirm your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Scan the QR code" })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await page.getByText("Can't scan it? Enter this key instead").click();
  secret = (await page.getByTestId("totp-secret").getAttribute("data-secret")) ?? "";
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await axe(page, "mfa step 2");
  await shot(page, "03-mfa-2-scan");

  await page.getByLabel("6-digit code from the app").fill(enrolmentCode());
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Save your backup codes" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Backup codes" }).getByRole("listitem")).toHaveCount(10);
  backupCodes = await page.getByRole("list", { name: "Backup codes" }).getByRole("listitem").allTextContents();
  const done = page.getByRole("button", { name: "Go to eMazeBrain" });
  await expect(done).toBeDisabled();
  await axe(page, "mfa step 3");
  await shot(page, "04-mfa-3-backup-codes");
  await page.getByLabel("I've saved my backup codes").check();
  await done.click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening), Yael/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your patients" }).getByRole("link").first()).toBeVisible();
  await axe(page, "today");
  await shot(page, "05-today");
  await page.context().storageState({ path: STATE });
});

test.describe("signed in", () => {
  // Reuse the session from enrolment instead of signing in (and spending a code) per test.
  test.use({ storageState: STATE });
  test.beforeEach(async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1, name: /Yael/ })).toBeVisible();
  });

  test("patients: one clinic at a time, searchable, each opens", async ({ page }) => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Patients" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Patients" })).toBeVisible();
    const table = page.getByRole("table", { name: "Patients on your caseload" });
    await expect(table).toBeVisible();

    // One clinic at a time: switching clinic changes the list (15 + 5 synthetic patients, plus the header row).
    const clinic = page.getByLabel("Clinic");
    await clinic.selectOption({ label: "Haifa North Clinic" });
    await expect(table.getByRole("row")).toHaveCount(6);
    await clinic.selectOption({ label: "Tel Aviv Child Development Center" });
    await expect(table.getByRole("row")).toHaveCount(16);
    const rowsBefore = 16;
    const first = table.getByRole("link").first();
    const name = (await first.textContent())!.trim();
    await axe(page, "patients");
    await shot(page, "06-patients");

    await page.getByRole("searchbox").fill(name.slice(0, 3));
    await expect(table.getByRole("link", { name })).toBeVisible();
    expect(await table.getByRole("row").count()).toBeLessThan(rowsBefore);
    await page.getByRole("searchbox").fill("zzzz");
    await expect(page.getByRole("heading", { name: "No patients match “zzzz”" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(table.getByRole("row")).toHaveCount(rowsBefore);

    await table.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("region", { name: "Details" })).toContainText("Date of birth");
    await axe(page, "patient");
    await shot(page, "07-patient");

    await page.goto("/patients/0192f3a0-0000-7000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "Patient not found" }).first()).toBeVisible();
  });

  test("Hebrew turns the whole app right to left", async ({ page }) => {
    await page.goto("/settings");
    await axe(page, "settings");
    await page.getByRole("radio", { name: "עברית" }).check();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.getByRole("heading", { level: 1, name: "הגדרות" })).toBeVisible();

    await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "מטופלים" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "מטופלים" })).toBeVisible();
    // The rail sits on the right in RTL.
    const rail = await page.locator(".emb-rail").boundingBox();
    expect(rail!.x).toBeGreaterThan(600);
    await axe(page, "patients (he)");
    await shot(page, "08-patients-he");

    await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "היום" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/בוקר טוב|צהריים טובים|ערב טוב/);
    await shot(page, "09-today-he");

    await page.goto("/settings");
    await page.getByRole("radio", { name: "English" }).check();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("tablet and phone layouts", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 }); // tablet, portrait
    await page.goto("/patients");
    await expect(page.getByRole("list", { name: "Patients on your caseload" })).toBeVisible();
    const rail = await page.locator(".emb-rail").boundingBox();
    expect(rail!.width).toBe(72);
    await axe(page, "patients (tablet)");
    await shot(page, "10-patients-tablet");

    await page.setViewportSize({ width: 390, height: 844 }); // phone
    await page.goto("/today");
    const tabs = page.getByRole("navigation", { name: "Main sections" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link")).toHaveText(["Today", "Patients", "Calendar", "Messages", "More"]);
    await expect(page.locator(".emb-rail")).toBeHidden();
    await axe(page, "today (phone)");
    await shot(page, "11-today-phone");
    await tabs.getByRole("link", { name: "More" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "More" })).toBeVisible();
    await shot(page, "12-more-phone");
  });

  test("keyboard: skip link, then sign out from the account menu", async ({ page }) => {
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();

    await page.getByRole("button", { name: "Account" }).click();
    await shot(page, "13-account-menu");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Account" })).toBeFocused();
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in\?reason=signed_out/);
    await expect(page.getByRole("status")).toHaveText("You've signed out.");
    await page.goto("/today");
    await expect(page).toHaveURL(/\/sign-in/);

    // Signing in again needs a code, and lands where the user was going.
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Authentication code").fill(signInCode()); // submits on the sixth digit
    await expect(page).toHaveURL(/\/today$/);
  });
});

test("a wrong code is refused; a backup code works once", async ({ page }) => {
  await page.goto("/sign-in?next=%2Fpatients");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
  await axe(page, "verify");
  await shot(page, "14-verify");
  await page.getByLabel("Authentication code").fill("000000");
  await expect(page.getByRole("alert")).toContainText("That code didn't work.");
  await expect(page.getByLabel("Authentication code")).toHaveValue("");

  await page.getByRole("button", { name: "Use a backup code instead" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Enter a backup code" })).toBeVisible();
  await page.getByLabel("Backup code").fill(backupCodes[0]!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/patients$/);
});
