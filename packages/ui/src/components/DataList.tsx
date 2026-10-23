/**
 * Data list (design doc §7.4): one component that renders a table on desktop
 * (≥ 1024 px) and a list of cards on tablet and phone. Each row can link to a
 * detail page; the whole row is the target, but only one link is in the tab
 * order, so keyboard and screen-reader users hear each row once.
 */
import type { ReactNode } from "react";
import { cx, useMediaQuery } from "./primitives.tsx";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** The row's title: the link text, and the card heading. Exactly one column. */
  primary?: boolean;
  /** Tabular, end-aligned numbers. */
  numeric?: boolean;
  /** Leave this column out of the card layout. */
  hideOnCard?: boolean;
}

export type RenderLink = (props: { href: string; className: string; children: ReactNode }) => ReactNode;

export interface DataListProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T) => string;
  /** Visually hidden table caption / list label. */
  caption: string;
  getRowHref?: (row: T) => string;
  /** The router's link component (keeps this package router-agnostic). */
  renderLink?: RenderLink;
  /** Optional leading visual, e.g. an avatar. */
  leading?: (row: T) => ReactNode;
  /** Force a layout; by default it follows the screen width. */
  layout?: "auto" | "table" | "cards";
}

const defaultLink: RenderLink = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

export function DataList<T>({ rows, columns, getRowKey, caption, getRowHref, renderLink = defaultLink, leading, layout = "auto" }: DataListProps<T>) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const asTable = layout === "table" || (layout === "auto" && wide);
  const primary = columns.find((c) => c.primary) ?? columns[0]!;

  const title = (row: T) => {
    const href = getRowHref?.(row);
    const content = primary.cell(row);
    return href ? renderLink({ href, className: "emb-stretched", children: content }) : content;
  };

  if (asTable) {
    return (
      <div className="emb-datalist emb-datalist--table">
        <table className="emb-table">
          <caption className="emb-vh">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.id} scope="col" className={cx(c.numeric && "is-numeric")}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)} className={cx(getRowHref && "is-linked")}>
                {columns.map((c) =>
                  c === primary ? (
                    <th key={c.id} scope="row">
                      <span className="emb-table__primary">
                        {leading?.(row)}
                        {title(row)}
                      </span>
                    </th>
                  ) : (
                    <td key={c.id} className={cx(c.numeric && "is-numeric")}>
                      {c.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="emb-datalist emb-datalist--cards" aria-label={caption}>
      {rows.map((row) => (
        <li key={getRowKey(row)} className={cx("emb-rowcard", getRowHref && "is-linked")}>
          {leading && <div className="emb-rowcard__leading">{leading(row)}</div>}
          <div className="emb-rowcard__main">
            <p className="emb-rowcard__title">{title(row)}</p>
            <dl className="emb-rowcard__meta">
              {columns
                .filter((c) => c !== primary && !c.hideOnCard)
                .map((c) => (
                  <div key={c.id} className="emb-rowcard__pair">
                    <dt>{c.header}</dt>
                    <dd className={cx(c.numeric && "is-numeric")}>{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        </li>
      ))}
    </ul>
  );
}
