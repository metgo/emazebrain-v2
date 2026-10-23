/**
 * Slice 2 end to end: the Library lists the games, and the preview runs the
 * real Catch Me If You Can in a sandboxed frame with the shared HUD.
 */
import { expect, test, type Page } from "@playwright/test";
import { axe, enrol, shot } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

async function stopFromPauseMenu(page: Page) {
  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: /Pause|השהיה/ }).click();
  const hold = game.locator("[data-quit]");
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(2300); // stopping needs a 2-second hold
  await page.mouse.up();
}

test("the library lists games and previews Catch Me If You Can in both palettes", async ({ page }) => {
  await enrol(page, "gil@synthetic.test");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await axe(page, "library");
  await shot(page, "30-library");

  await page.getByRole("link", { name: /Catch Me If You Can/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catch Me If You Can" })).toBeVisible();
  await axe(page, "game page");
  await shot(page, "31-game-page");

  // Warm palette, Lives mode, no practice.
  await page.getByRole("radio", { name: "Lives", exact: true }).check();
  await page.getByLabel("Start with practice").uncheck();
  await page.getByRole("button", { name: "Start preview" }).click();
  await expect(page.getByRole("navigation")).toHaveCount(0);

  const frame = page.locator("iframe.gameframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const game = page.frameLocator("iframe.gameframe");
  await expect(game.getByRole("heading", { name: "Catch Me If You Can" })).toBeVisible({ timeout: 15000 });
  await shot(page, "32-game-instructions");
  await game.getByRole("button", { name: "Play" }).click();
  await expect(game.locator(".hud-hearts .heart.full")).toHaveCount(3);
  await expect(game.locator(".hud-timer")).toBeHidden(); // Lives mode: no clock on screen
  await page.waitForTimeout(600);
  await shot(page, "33-game-warm");

  // Tap a tile: the centre of the first quarter of the board.
  const box = (await frame.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
  await page.waitForTimeout(1500);

  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "Great effort!" })).toBeVisible();
  await expect(game.getByRole("img", { name: /of 3 stars/ })).toBeVisible();
  await game.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Preview finished. Nothing was saved.")).toBeVisible();
  await expect(page.getByText("Stopped early")).toBeVisible();
  await axe(page, "preview finished");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catch Me If You Can" })).toBeVisible();
});

test("cold palette, timed, in Hebrew: the clock waits for the first tap, and the timer stays on the right", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enrol(page, "shira@synthetic.test");
  await page.goto("/library/catch-me-if-you-can");
  await page.getByRole("radio", { name: "Cold, right hemisphere" }).check();
  await page.getByRole("radio", { name: "Timed", exact: true }).check();
  await page.getByLabel("Game language").selectOption("he");
  await page.getByLabel("Start with practice").uncheck();
  await page.getByRole("button", { name: "Start preview" }).click();

  const game = page.frameLocator("iframe.gameframe");
  await game.getByRole("button", { name: "משחקים!" }).click();
  const timer = game.locator(".hud-timer");
  await expect(timer).toHaveClass(/side-right/);
  await expect(timer.locator(".time")).toHaveText("2:00");
  await page.waitForTimeout(1500);
  await expect(timer.locator(".time")).toHaveText("2:00"); // not started: no tap yet
  const box = (await page.locator("iframe.gameframe").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
  await expect(timer.locator(".time")).not.toHaveText("2:00", { timeout: 4000 });
  const tb = (await timer.boundingBox())!;
  expect(tb.x).toBeGreaterThan(box.width / 2); // physical right, not mirrored
  await shot(page, "34-game-cold-he");
  await stopFromPauseMenu(page);
  await expect(game.getByRole("heading", { name: "כל הכבוד על המאמץ!" })).toBeVisible();
  await context.close();
});
