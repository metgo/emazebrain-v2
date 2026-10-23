import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { ageParts, dayPart, matchesQuery, searchKey } from "../src/lib/format.ts";
import { useIdleTimeout } from "../src/lib/idle.ts";
import { detectLocale } from "../src/i18n/index.tsx";
import { safeNext } from "../src/routes/auth.tsx";

describe("ageParts", () => {
  const today = new Date(2026, 9, 23); // 23 Oct 2026
  it("counts whole years and months", () => {
    expect(ageParts("2018-03-01", today)).toEqual({ years: 8, months: 103 });
    expect(ageParts("2018-10-24", today).years).toBe(7); // birthday tomorrow
    expect(ageParts("2018-10-23", today).years).toBe(8); // birthday today
    expect(ageParts("2025-12-01", today)).toEqual({ years: 0, months: 10 });
  });
  it("never goes negative", () => {
    expect(ageParts("2030-01-01", today)).toEqual({ years: 0, months: 0 });
  });
});

describe("search", () => {
  it("ignores Hebrew vowel points and case", () => {
    expect(searchKey("נֹעָה")).toBe("נעה".length === 3 ? searchKey("נועה").replace("ו", "") : "");
    expect(matchesQuery(["נועה", "כהן"], "נוע")).toBe(true);
    expect(matchesQuery(["שִׁירָה", "לוי"], "שירה")).toBe(true);
    expect(matchesQuery(["Noa", "Carter"], "CAR")).toBe(true);
  });
  it("matches every term against the start of a word", () => {
    expect(matchesQuery(["Noa", "Carter", "Noa Carter"], "noa car")).toBe(true);
    expect(matchesQuery(["Noa", "Carter", "Noa Carter"], "arte")).toBe(false);
    expect(matchesQuery(["Noa", "Carter"], "  ")).toBe(true);
  });
});

describe("dayPart", () => {
  it("splits the day for the greeting", () => {
    expect(dayPart(new Date(2026, 0, 1, 8))).toBe("morning");
    expect(dayPart(new Date(2026, 0, 1, 13))).toBe("afternoon");
    expect(dayPart(new Date(2026, 0, 1, 19))).toBe("evening");
  });
});

describe("detectLocale", () => {
  it("prefers the saved choice, then the first supported browser language", () => {
    expect(detectLocale("en", ["he-IL"])).toBe("en");
    expect(detectLocale(null, ["he-IL", "en-US"])).toBe("he");
    expect(detectLocale(null, ["iw"])).toBe("he");
    expect(detectLocale(null, ["fr-FR", "en-GB", "he"])).toBe("en");
    expect(detectLocale(null, ["ja"])).toBe("en");
  });
});

describe("safeNext", () => {
  it("only accepts paths inside the app", () => {
    expect(safeNext("/patients?q=noa")).toBe("/patients?q=noa");
    expect(safeNext("//evil.example")).toBe("/today");
    expect(safeNext("https://evil.example")).toBe("/today");
    expect(safeNext(null)).toBe("/today");
  });
});

describe("useIdleTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once after the limit without input, and input resets it", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(onIdle, 60_000, 1_000));
    vi.advanceTimersByTime(50_000);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    vi.advanceTimersByTime(50_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
