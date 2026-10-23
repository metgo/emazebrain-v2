/**
 * Kid mode (design doc §4.3): while a child holds the tablet, therapist
 * controls sit behind a per-device PIN. Stored only as a salted hash in this
 * browser; five wrong tries lock it for a minute.
 */
const KEY = "emb.kidpin.v1";
const LOCK_KEY = "emb.kidpin.lock.v1";
export const MAX_TRIES = 5;
export const LOCK_MS = 60_000;

interface Stored {
  salt: string;
  hash: string;
}
interface Lock {
  fails: number;
  until: number;
}

export const PIN_PATTERN = /^\d{4,6}$/;

async function digest(salt: string, pin: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function put(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* blocked storage: the PIN won't persist, and hasPin() stays false */
  }
}

export function hasPin(): boolean {
  return get<Stored>(KEY) !== null;
}

export async function setPin(pin: string): Promise<void> {
  if (!PIN_PATTERN.test(pin)) throw new Error("invalid_pin");
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  put(KEY, { salt, hash: await digest(salt, pin) });
  put(LOCK_KEY, { fails: 0, until: 0 });
}

/** Milliseconds left on the lock, or 0. */
export function lockedFor(now = Date.now()): number {
  const l = get<Lock>(LOCK_KEY);
  return l && l.until > now ? l.until - now : 0;
}

export type CheckResult = { ok: true } | { ok: false; locked_ms: number; tries_left: number };

export async function checkPin(pin: string, now = Date.now()): Promise<CheckResult> {
  const left = lockedFor(now);
  if (left) return { ok: false, locked_ms: left, tries_left: 0 };
  const s = get<Stored>(KEY);
  if (s && (await digest(s.salt, pin)) === s.hash) {
    put(LOCK_KEY, { fails: 0, until: 0 });
    return { ok: true };
  }
  const prev = get<Lock>(LOCK_KEY) ?? { fails: 0, until: 0 };
  const fails = prev.fails + 1;
  if (fails >= MAX_TRIES) {
    put(LOCK_KEY, { fails: 0, until: now + LOCK_MS });
    return { ok: false, locked_ms: LOCK_MS, tries_left: 0 };
  }
  put(LOCK_KEY, { fails, until: 0 });
  return { ok: false, locked_ms: 0, tries_left: MAX_TRIES - fails };
}
