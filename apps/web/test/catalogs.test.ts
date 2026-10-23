/**
 * Every language has every message, each message is valid ICU, and each
 * translation uses exactly the same arguments as English (so {name} can't be
 * dropped or misspelled). CLAUDE.md invariant 10.
 */
import { describe, expect, it } from "vitest";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import en from "../src/i18n/messages/en.json";
import he from "../src/i18n/messages/he.json";

const catalogs = { en, he } as Record<string, Record<string, string>>;

function args(els: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of els) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.add(el.value);
    if (el.type === TYPE.select || el.type === TYPE.plural) {
      out.add(el.value);
      for (const opt of Object.values(el.options)) args(opt.value, out);
    }
    if (el.type === TYPE.tag) args(el.children, out);
  }
  return out;
}

describe("message catalogs", () => {
  const keys = Object.keys(en).sort();

  for (const [locale, cat] of Object.entries(catalogs)) {
    it(`${locale} has exactly the English keys`, () => {
      expect(Object.keys(cat).sort()).toEqual(keys);
    });

    it(`${locale} messages parse and use the same arguments as English`, () => {
      for (const key of keys) {
        const msg = cat[key]!;
        expect(msg.trim(), `${locale}:${key} is empty`).not.toBe("");
        const ast = parse(msg);
        expect([...args(ast)].sort(), `${locale}:${key}`).toEqual([...args(parse(en[key as keyof typeof en]))].sort());
      }
    });
  }

  it("never calls games an assessment, treatment or diagnosis (invariant 9)", () => {
    // Only the words people read count; select keys like "treatment" are codes.
    const literal = (els: MessageFormatElement[]): string =>
      els
        .map((el) =>
          el.type === TYPE.literal ? el.value
          : el.type === TYPE.select || el.type === TYPE.plural ? Object.values(el.options).map((o) => literal(o.value)).join(" ")
          : el.type === TYPE.tag ? literal(el.children)
          : "",
        )
        .join(" ");
    const banned = /\b(assessment|treatment|diagnos\w*)\b|אבחון|אבחנה|טיפול/i;
    for (const [locale, cat] of Object.entries(catalogs)) {
      for (const [key, msg] of Object.entries(cat)) {
        const text = literal(parse(msg));
        expect(banned.test(text), `${locale}:${key}: ${text}`).toBe(false);
      }
    }
  });
});
