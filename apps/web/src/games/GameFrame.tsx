/**
 * Hosts one game in an opaque-origin sandboxed iframe (design doc §8.3): the
 * game can run scripts but has no network, no storage and no access to the
 * app. The host sends the launch parameters and receives the results.
 */
import { useEffect, useRef, useState } from "react";
import { isFrameMessage, type FrameToHost, type HostToFrame, type LaunchParams, type ResultEnvelope } from "@emb/game-runtime/protocol";
import { MazeLoader } from "@emb/ui";
import type { GameEntry } from "./registry.ts";

const READY_TIMEOUT_MS = 10_000;

// No network at all from inside the frame: only its own inline script and styles.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; worker-src blob:";

export function frameDocument(bundle: string): string {
  const safe = bundle.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><script>${safe}</script></body></html>`;
}

export interface GameFrameProps {
  game: GameEntry;
  sessionId: string;
  params: LaunchParams;
  demo: boolean;
  title: string;
  loadingLabel: string;
  onStarted?: () => void;
  onEnded?: (envelope: ResultEnvelope) => void;
  onClosed?: () => void;
  onError?: (message: string) => void;
  /** Lets the parent pause, resume or end the game (therapist controls). */
  control?: (send: (msg: HostToFrame) => void) => void;
}

export function GameFrame(p: GameFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const cbs = useRef(p);
  cbs.current = p;

  useEffect(() => {
    let live = true;
    p.game
      .loadFrame()
      .then((bundle) => live && setDoc(frameDocument(bundle)))
      .catch((e: Error) => cbs.current.onError?.(e.message));
    return () => {
      live = false;
    };
  }, [p.game]);

  useEffect(() => {
    if (!doc) return;
    const win = () => frame.current?.contentWindow ?? null;
    const send = (msg: HostToFrame) => win()?.postMessage(msg, "*"); // opaque origin: "*" is the only target
    cbs.current.control?.(send);
    let ready = false;
    const timer = window.setTimeout(() => {
      if (!ready) cbs.current.onError?.("The game didn't start.");
    }, READY_TIMEOUT_MS);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== win() || !isFrameMessage(e.data)) return;
      const m = e.data as FrameToHost;
      if (m.type === "ready" && !ready) {
        ready = true;
        window.clearTimeout(timer);
        send({ type: "launch", sessionId: cbs.current.sessionId, params: cbs.current.params, demo: cbs.current.demo });
        frame.current?.focus();
      } else if (m.type === "started") cbs.current.onStarted?.();
      else if (m.type === "ended") cbs.current.onEnded?.(m.envelope);
      else if (m.type === "closed") cbs.current.onClosed?.();
      else if (m.type === "error") cbs.current.onError?.(m.message);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [doc]);

  if (!doc) return <MazeLoader label={p.loadingLabel} />;
  return <iframe ref={frame} className="gameframe" title={p.title} sandbox="allow-scripts" srcDoc={doc} />;
}
