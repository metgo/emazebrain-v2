import { useEffect, useRef } from "react";

/** Design doc §11.2: the web app locks after 15 minutes without input. */
export const IDLE_LIMIT_MS = 15 * 60 * 1000;

const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Calls onIdle once after `limitMs` without user input. Checks elapsed wall
 * time rather than trusting one long timer, so a laptop that slept or a
 * throttled background tab still locks on return.
 */
export function useIdleTimeout(onIdle: () => void, limitMs = IDLE_LIMIT_MS, checkEveryMs = 15_000) {
  const last = useRef(Date.now());
  const fired = useRef(false);
  const cb = useRef(onIdle);
  cb.current = onIdle;

  useEffect(() => {
    const touch = () => {
      last.current = Date.now();
    };
    const check = () => {
      if (!fired.current && Date.now() - last.current >= limitMs) {
        fired.current = true;
        cb.current();
      }
    };
    for (const e of ACTIVITY) window.addEventListener(e, touch, { passive: true, capture: true });
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, checkEveryMs);
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, [limitMs, checkEveryMs]);
}
