/**
 * Slice 5 end to end: a therapist opens a patient's Progress tab and reads a
 * real trend (12 synthetic sessions, difficulty 3 → 4), switches to a skill,
 * uses the table view and the keyboard, and sees the same page in Hebrew.
 */
import { expect, test } from "@playwright/test";
import { axe, enrol, shot } from "./helpers.ts";

test("Maya reads Ella's progress: trend, skill view, table, difficulty change, history", async ({ page }) => {
  await enrol(page, "maya@synthetic.test");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Patients" }).click();
  await page.getByRole("searchbox").fill("Ella");
  await page.getByRole("link", { name: "Ella Navon" }).click();
  await page.getByRole("navigation", { name: "Patient sections" }).getByRole("link", { name: "Progress" }).click();
  await expect(page).toHaveURL(/\/progress$/);

  // Accuracy: the dip after moving up to difficulty 4 is scored against a fresh baseline, so recent sessions still read above it.
  await expect(page.getByRole("heading", { name: "Accuracy compared with ⁨Ella⁩'s first sessions" })).toBeVisible();
  await expect(page.getByText("Above baseline")).toBeVisible();
  const chart = page.getByRole("group", { name: /Trend chart: Accuracy, 12 sessions/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator(".trend__dot")).toHaveCount(12);
  await expect(chart.locator(".trend__dot--base")).toHaveCount(4); // two at difficulty 3, two at 4
  await expect(chart.locator(".trend__change")).toHaveCount(1);
  await axe(page, "progress");
  await shot(page, "60-progress");

  // Hover shows the session; the keyboard does the same and announces it.
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width - 60, box.y + 120);
  await expect(chart.locator(".trend__tip")).toContainText("Session 12");
  await shot(page, "61-progress-hover");
  await chart.screenshot({ path: "test-results/screens/61b-progress-chart.png" });
  await chart.focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".trend [aria-live]")).toContainText("Session 1");
  await expect(page.locator(".trend [aria-live]")).toContainText("Sets the baseline");

  // Response time and a skill from the game's own metrics.
  await page.getByLabel("Show").selectOption({ label: "Response time" });
  await expect(page.getByRole("heading", { name: /Response time compared with/ })).toBeVisible();
  await page.getByLabel("Show").selectOption({ label: "Visual discrimination" });
  await expect(page.getByRole("heading", { name: /Visual discrimination compared with/ })).toBeVisible();
  await expect(page.getByText(/Recent sessions average \d+, above/)).toBeVisible();

  // The same numbers as a table.
  await page.getByRole("button", { name: "Show as table" }).click();
  const table = page.getByRole("table", { name: "Visual discrimination: each session compared with baseline" });
  await expect(table.getByRole("row")).toHaveCount(13);
  await expect(table.getByRole("row").nth(12)).toContainText("Sets the baseline");
  await axe(page, "progress table");
  await page.getByRole("button", { name: "Show as chart" }).click();

  await expect(page.getByText("Raised from 3 to 4 after strong sessions in a row")).toBeVisible();
  const history = page.getByRole("table", { name: "Every game played, newest first" });
  await expect(history.getByRole("row")).toHaveCount(13);
  await expect(history.getByRole("row").nth(1)).toContainText("Out of hearts");

  // Hebrew: the page mirrors, the plot keeps reading left to right.
  await page.goto("/settings");
  await page.getByRole("radio", { name: "עברית" }).check();
  await page.goBack();
  await expect(page.getByRole("heading", { name: /דיוק בהשוואה למפגשים הראשונים של/ })).toBeVisible();
  await expect(page.getByText("מעל נקודת הבסיס", { exact: true })).toBeVisible();
  await expect(page.locator(".trend")).toHaveAttribute("dir", "ltr");
  await axe(page, "progress (he)");
  await shot(page, "62-progress-he");
  await page.goto("/settings");
  await page.getByRole("radio", { name: "English" }).check();
});

