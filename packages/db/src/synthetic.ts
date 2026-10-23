/**
 * Synthetic-data factory (CLAUDE.md invariant 1). The only source of patient
 * data outside production: seeds, demos, fixtures and screenshots all come
 * from here. Every record is invented and deterministic for a given seed;
 * names come from the fixed lists below, and email addresses use the reserved
 * .test domain so nothing can ever be delivered.
 */

/** Mulberry32: small, fast, deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  he: {
    given: ["נועה", "איתי", "מאיה", "יונתן", "תמר", "אורי", "שירה", "דניאל", "הילה", "עומר", "רוני", "אביגיל", "ליאם", "יעל", "נדב", "אלה"],
    family: ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "פרידמן", "שפירא", "אזולאי", "גבאי", "דהן", "רוזן"],
  },
  en: {
    given: ["Noa", "Ethan", "Maya", "Jonah", "Lily", "Owen", "Ava", "Leo", "Zoe", "Eli", "Nora", "Sam"],
    family: ["Carter", "Reyes", "Bennett", "Okafor", "Lindqvist", "Moreau", "Haddad", "Nakamura", "Walsh", "Patel"],
  },
} as const;

export type SyntheticStatus = "pending_consent" | "consent_legacy" | "active" | "inactive" | "discharged";

export interface SyntheticPatient {
  given_name: string;
  family_name: string;
  /** YYYY-MM-DD */
  date_of_birth: string;
  status: SyntheticStatus;
  preferred_locale: "he" | "en";
}

/** Children aged roughly 4–12 relative to `today`, mostly active. */
export function syntheticPatients(count: number, opts: { seed?: number; locale?: "he" | "en" | "mixed"; today?: Date } = {}): SyntheticPatient[] {
  const r = rng(opts.seed ?? 42);
  const today = opts.today ?? new Date();
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const statuses: SyntheticStatus[] = ["active", "active", "active", "active", "active", "pending_consent", "consent_legacy", "inactive"];
  const out: SyntheticPatient[] = [];
  const seen = new Set<string>();
  while (out.length < count) {
    const loc = opts.locale === "mixed" ? (r() < 0.75 ? "he" : "en") : (opts.locale ?? "he");
    const given = pick(NAMES[loc].given);
    const family = pick(NAMES[loc].family);
    if (seen.has(given + family)) continue;
    seen.add(given + family);
    const ageDays = Math.floor((4 + r() * 8.5) * 365.25);
    const dob = new Date(today.getTime() - ageDays * 86_400_000);
    out.push({
      given_name: given,
      family_name: family,
      date_of_birth: dob.toISOString().slice(0, 10),
      status: pick(statuses),
      preferred_locale: loc,
    });
  }
  return out;
}

export const SYNTHETIC_EMAIL_DOMAIN = "synthetic.test";
