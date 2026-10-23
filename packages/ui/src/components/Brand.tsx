/**
 * Brand mark (design doc §7): a single-line maze inside a rounded, two-lobed
 * outline. The same path draws itself as the loading motif. The wordmark is
 * a name, so it is never mirrored or translated.
 */
const MAZE =
  "M16 29 V25 H9 a5 5 0 0 1 -5 -5 V12 a6 6 0 0 1 6 -6 H14 V9 M18 9 V6 H22 a6 6 0 0 1 6 6 V20 a5 5 0 0 1 -5 5 H20 V11 H11 V21 H16 V15";

export function LogoMark({ size = 32, title }: { size?: number; title?: string | undefined }) {
  return (
    <svg
      className="emb-logomark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d={MAZE} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 32, collapsed = false }: { size?: number; collapsed?: boolean }) {
  return (
    <span className="emb-logo" dir="ltr">
      <LogoMark size={size} title={collapsed ? "eMazeBrain" : undefined} />
      {!collapsed && (
        <span className="emb-logo__word">
          e<b>Maze</b>Brain
        </span>
      )}
    </span>
  );
}

/** Full-area loading state: the maze path drawing itself. */
export function MazeLoader({ label }: { label: string }) {
  return (
    <div className="emb-mazeloader" role="status">
      <svg width={56} height={56} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d={MAZE} className="emb-mazeloader__track" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d={MAZE} className="emb-mazeloader__path" pathLength={100} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="emb-vh">{label}</span>
    </div>
  );
}
