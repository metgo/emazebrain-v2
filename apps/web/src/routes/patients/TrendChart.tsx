/**
 * One-series trend chart for the Progress tab (design doc §5.9; dataviz rules):
 * 2 px line, 8 px markers with a 2 px surface ring, a reference line at the
 * baseline (100), a difficulty lane under the plot, a crosshair + tooltip on
 * hover and on arrow keys, and an end label. Points are evenly spaced by
 * session so a busy week doesn't crowd the chart; dates are in the tooltip
 * and the table view.
 *
 * The plot stays left-to-right in every language (numbers and session order
 * read the same way in Hebrew clinical charts). [Open] confirm with Hebrew
 * and Arabic users, design doc §7.8.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TrendPoint } from "@emb/metrics";

export interface ChartText {
  label: string;
  baseline: string;
  difficulty: string;
  session: (n: number) => string;
  score: (score: string) => string;
  settingBaseline: string;
  noScore: string;
  date: (iso: string) => string;
  game: (id: string) => string;
  value: (p: TrendPoint) => string | null;
  number: (n: number) => string;
}

const H = 260; // plot + lane
const M = { top: 16, right: 56, bottom: 52, left: 44 }; // physical-ok: SVG geometry, the plot never mirrors
const LANE = 22;

function niceDomain(scores: number[]): [number, number] {
  const lo = Math.min(75, ...scores);
  const hi = Math.max(125, ...scores);
  return [Math.floor((lo - 5) / 25) * 25, Math.ceil((hi + 5) / 25) * 25];
}

export function TrendChart({ points, text }: { points: TrendPoint[]; text: ChartText }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  // Screen readers hear the point only when it was chosen with the keyboard, not on every pointer move.
  const [viaKeys, setViaKeys] = useState(false);
  const tipId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scored = points.map((p) => p.score).filter((s): s is number => s !== null);
  const [y0, y1] = useMemo(() => niceDomain(scored), [scored.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const x = (i: number) => M.left + (points.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => M.top + plotH - ((v - y0) / (y1 - y0)) * plotH;
  const ticks: number[] = [];
  for (let v = y0; v <= y1; v += 25) ticks.push(v);

  // Line segments skip sessions that can't be scored, rather than bridging them.
  const segments: string[] = [];
  let cur = "";
  points.forEach((p, i) => {
    if (p.score === null) {
      if (cur) segments.push(cur);
      cur = "";
      return;
    }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`;
  });
  if (cur) segments.push(cur);

  // Difficulty lane: one block per run of the same difficulty.
  const runs: Array<{ from: number; to: number; d: number }> = [];
  points.forEach((p, i) => {
    const last = runs.at(-1);
    if (last && last.d === p.difficulty) last.to = i;
    else runs.push({ from: i, to: i, d: p.difficulty });
  });
  const half = points.length > 1 ? step / 2 : plotW / 2;
  const laneY = H - M.bottom + 26;

  // Label every n-th session so axis labels never collide (~48 px each).
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 48))));
  const lastScored = [...points].map((p, i) => ({ p, i })).reverse().find(({ p }) => p.score !== null);

  const onKey = (e: KeyboardEvent) => {
    if (!points.length) return;
    setViaKeys(true);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(points.length - 1, Math.max(0, (a ?? (d > 0 ? -1 : points.length)) + d)));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(points.length - 1);
    } else if (e.key === "Escape") setActive(null);
  };

  const onMove = (clientX: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || !points.length) return;
    setViaKeys(false);
    const px = clientX - box.left;
    const i = points.length > 1 ? Math.round((px - M.left) / step) : 0;
    setActive(Math.min(points.length - 1, Math.max(0, i)));
  };

  const ap = active !== null ? points[active] : undefined;
  // The tooltip sits beside the point, on the side with more room, so it never hides what it describes.
  const TIP_W = 220;
  const tipLeft = ap ? (x(active!) > width / 2 ? Math.max(4, x(active!) - TIP_W - 16) : Math.min(width - TIP_W - 4, x(active!) + 16)) : 0;

  return (
    <div
      ref={wrap}
      className="trend"
      dir="ltr"
      tabIndex={0}
      role="group"
      aria-label={text.label}
      onKeyDown={onKey}
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
    >
      <svg width={width} height={H} role="presentation" aria-hidden="true" className="trend__svg">
        {/* gridlines + y ticks */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} className="trend__grid" />
            <text x={M.left - 8} y={y(v)} className="trend__tick" textAnchor="end" dominantBaseline="middle">
              {text.number(v)}
            </text>
          </g>
        ))}
        {/* baseline reference */}
        <line x1={M.left} x2={width - M.right} y1={y(100)} y2={y(100)} className="trend__base" />
        <text x={width - M.right + 6} y={y(100)} className="trend__baselabel" dominantBaseline="middle">
          {text.baseline}
        </text>
        {/* difficulty lane */}
        {runs.map((r, k) => {
          const x1 = Math.max(M.left - 4, x(r.from) - half);
          const x2 = Math.min(width - M.right + 4, x(r.to) + half);
          return (
            <g key={k}>
              <rect x={x1 + 1} y={laneY - LANE / 2} width={Math.max(2, x2 - x1 - 2)} height={LANE} rx={4} className={k % 2 ? "trend__lane trend__lane--alt" : "trend__lane"} />
              {x2 - x1 > 18 && (
                <text x={(x1 + x2) / 2} y={laneY} className="trend__lanetext" textAnchor="middle" dominantBaseline="central">
                  {x2 - x1 > 110 ? `${text.difficulty} ${r.d}` : r.d}
                </text>
              )}
            </g>
          );
        })}
        {/* difficulty changes */}
        {points.map((p, i) =>
          p.difficultyChanged ? <line key={`c${i}`} x1={x(i) - half} x2={x(i) - half} y1={M.top} y2={laneY + LANE / 2} className="trend__change" /> : null,
        )}
        {/* x labels */}
        {points.map((_, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={`x${i}`} x={x(i)} y={H - M.bottom + 4} className="trend__tick" textAnchor="middle" dominantBaseline="hanging">
              {i + 1}
            </text>
          ) : null,
        )}
        {/* crosshair */}
        {ap && <line x1={x(active!)} x2={x(active!)} y1={M.top} y2={H - M.bottom} className="trend__cross" />}
        {/* series */}
        {segments.map((d, k) => (
          <path key={k} d={d} className="trend__line" />
        ))}
        {points.map((p, i) =>
          p.score === null ? null : (
            <circle
              key={p.sessionId}
              cx={x(i)}
              cy={y(p.score)}
              r={active === i ? 6 : 4}
              className={p.isBaseline ? "trend__dot trend__dot--base" : "trend__dot"}
            />
          ),
        )}
        {/* end label: the latest score, the one number the reader came for */}
        {lastScored && (
          <text x={x(lastScored.i) + 9} y={y(lastScored.p.score!) - 9} className="trend__endlabel">
            {text.number(lastScored.p.score!)}
          </text>
        )}
      </svg>
      {ap && (
        <div className="trend__tip" id={tipId} aria-hidden="true" style={{ insetInlineStart: tipLeft }}>
          <p className="trend__tipvalue">{ap.score !== null ? text.score(text.number(ap.score)) : text.noScore}</p>
          <p>{text.session(active! + 1)} · {text.date(ap.endedAt)}</p>
          <p>
            {text.game(ap.gameId)} · {text.difficulty} {ap.difficulty}
          </p>
          {text.value(ap) && <p>{text.value(ap)}</p>}
          {ap.isBaseline && <p className="trend__tipnote">{text.settingBaseline}</p>}
        </div>
      )}
      <p className="emb-vh" aria-live="polite">
        {ap && viaKeys
          ? [
              text.session(active! + 1),
              text.date(ap.endedAt),
              ap.score !== null ? text.score(text.number(ap.score)) : text.noScore,
              text.value(ap),
              `${text.difficulty} ${ap.difficulty}`,
              ap.isBaseline ? text.settingBaseline : null,
            ]
              .filter(Boolean)
              .join(", ")
          : ""}
      </p>
    </div>
  );
}
