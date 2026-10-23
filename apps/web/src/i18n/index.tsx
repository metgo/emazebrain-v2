/**
 * Languages, direction and display preferences (design doc §7.2, §7.8, §11.6).
 * All UI text is an ICU message; nothing user-visible is hard-coded.
 * Hebrew and English ship first; Arabic and the other v1 languages follow
 * by adding a catalog here (the catalog test checks every key and argument).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IntlProvider, useIntl } from "react-intl";
import en from "./messages/en.json";
import he from "./messages/he.json";

export type MessageId = keyof typeof en;
export const locales = ["en", "he"] as const;
export type Locale = (typeof locales)[number];
export type Theme = "light" | "dark" | "system";
export type Motion = "system" | "reduce";

const catalogs: Record<Locale, Record<MessageId, string>> = { en, he };
const rtl = new Set<Locale>(["he"]);

export const isRtl = (l: Locale) => rtl.has(l);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the preference just isn't remembered */
  }
}

/** Saved choice, else the first of the browser's languages we support. Mirrors the script in index.html. */
export function detectLocale(saved = read("emb.locale"), prefs: readonly string[] = typeof navigator !== "undefined" ? navigator.languages : []): Locale {
  if (saved === "he" || saved === "en") return saved;
  for (const p of prefs) {
    const two = p.slice(0, 2).toLowerCase();
    if (two === "he" || two === "iw") return "he";
    if (two === "en") return "en";
  }
  return "en";
}

interface Prefs {
  locale: Locale;
  setLocale: (l: Locale) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  motion: Motion;
  setMotion: (m: Motion) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale());
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = read("emb.theme") ?? (typeof document !== "undefined" ? (document.documentElement.dataset.theme ?? null) : null);
    return t === "light" || t === "dark" ? t : "system";
  });
  const [motion, setMotionState] = useState<Motion>(() => (read("emb.motion") === "reduce" ? "reduce" : "system"));

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = isRtl(locale) ? "rtl" : "ltr";
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (motion === "reduce") document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [motion]);

  const setLocale = useCallback((l: Locale) => {
    write("emb.locale", l);
    setLocaleState(l);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    write("emb.theme", t);
    setThemeState(t);
  }, []);
  const setMotion = useCallback((m: Motion) => {
    write("emb.motion", m);
    setMotionState(m);
  }, []);

  const value = useMemo(() => ({ locale, setLocale, theme, setTheme, motion, setMotion }), [locale, setLocale, theme, setTheme, motion, setMotion]);

  return (
    <PrefsContext.Provider value={value}>
      <IntlProvider locale={locale} messages={catalogs[locale]} defaultLocale="en" onError={onIntlError}>
        {children}
      </IntlProvider>
    </PrefsContext.Provider>
  );
}

function onIntlError(err: { code?: string; message: string }) {
  // A missing translation is a build-time failure (catalog test), not a runtime one.
  if (import.meta.env.DEV) console.warn(err.message);
}

export function usePrefs(): Prefs {
  const p = useContext(PrefsContext);
  if (!p) throw new Error("usePrefs outside PrefsProvider");
  return p;
}

/** t("patients.count", { count: 3 }) — typed message ids. */
export function useT() {
  const intl = useIntl();
  return useCallback(
    (id: MessageId, values?: Record<string, string | number | Date | null | undefined>) => intl.formatMessage({ id }, values as never) as string,
    [intl],
  );
}
