/**
 * App shell (design doc §4.2):
 * - desktop ≥ 1024 px: left rail 240 px with icons + labels, collapsible to 72 px;
 * - tablet 768–1023 px: rail 72 px with labels under the icons (no hover needed);
 * - phone < 768 px: bottom tabs, at most 5 (four destinations + More).
 * The rail sits at the inline start, so it moves to the right in Hebrew and Arabic.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cx } from "./primitives.tsx";

export type IconType = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true"; className?: string }>;

export interface ShellNavItem {
  id: string;
  href: string;
  label: string;
  icon: IconType;
  /** Small count, e.g. unread messages. Announced with the label. */
  badge?: number;
  badgeLabel?: string;
}

export type RenderNavLink = (props: { href: string; className: string; children: ReactNode; "aria-current"?: "page" }) => ReactNode;

export interface AppShellProps {
  brand: ReactNode;
  navLabel: string;
  tabsLabel: string;
  items: ShellNavItem[];
  /** Destinations shown as bottom tabs on phones (≤ 4); `more` is appended. */
  tabIds: string[];
  more: ShellNavItem;
  isActive: (item: ShellNavItem) => boolean;
  renderLink: RenderNavLink;
  topBar: ReactNode;
  skipLabel: string;
  railCollapsed?: boolean;
  onToggleRail?: () => void;
  toggleLabels?: { collapse: string; expand: string };
  children: ReactNode;
}

export function AppShell(p: AppShellProps) {
  const tabs = p.tabIds.map((id) => p.items.find((i) => i.id === id)).filter((i): i is ShellNavItem => !!i).slice(0, 4);
  const moreActive = !tabs.some(p.isActive);

  const link = (item: ShellNavItem, className: string, active: boolean) =>
    p.renderLink({
      href: item.href,
      className: cx(className, active && "is-active"),
      ...(active ? { "aria-current": "page" as const } : {}),
      children: (
        <>
          <span className="emb-nav__icon">
            <item.icon size={22} aria-hidden="true" />
            {item.badge ? (
              <span className="emb-nav__badge" aria-hidden="true">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </span>
          <span className="emb-nav__label">{item.label}</span>
          {item.badge && item.badgeLabel ? <span className="emb-vh">{item.badgeLabel}</span> : null}
        </>
      ),
    });

  return (
    <div className={cx("emb-shell", p.railCollapsed && "emb-shell--collapsed")}>
      <a className="emb-skiplink" href="#main">
        {p.skipLabel}
      </a>
      <aside className="emb-rail">
        <div className="emb-rail__brand">{p.brand}</div>
        <nav aria-label={p.navLabel}>
          <ul className="emb-rail__list">
            {p.items.map((item) => (
              <li key={item.id}>{link(item, "emb-nav emb-nav--rail", p.isActive(item))}</li>
            ))}
          </ul>
        </nav>
        {p.onToggleRail && p.toggleLabels && (
          <button
            type="button"
            className="emb-rail__toggle"
            onClick={p.onToggleRail}
            aria-pressed={p.railCollapsed ?? false}
            aria-label={p.railCollapsed ? p.toggleLabels.expand : p.toggleLabels.collapse}
            title={p.railCollapsed ? p.toggleLabels.expand : p.toggleLabels.collapse}
          >
            {p.railCollapsed ? <PanelLeftOpen size={20} aria-hidden="true" className="emb-flip-rtl" /> : <PanelLeftClose size={20} aria-hidden="true" className="emb-flip-rtl" />}
          </button>
        )}
      </aside>
      <header className="emb-topbar">{p.topBar}</header>
      <main id="main" className="emb-main" tabIndex={-1}>
        {p.children}
      </main>
      <nav className="emb-tabs" aria-label={p.tabsLabel}>
        <ul className="emb-tabs__list">
          {tabs.map((item) => (
            <li key={item.id}>{link(item, "emb-nav emb-nav--tab", p.isActive(item))}</li>
          ))}
          <li>{link(p.more, "emb-nav emb-nav--tab", moreActive && p.isActive(p.more))}</li>
        </ul>
      </nav>
    </div>
  );
}

/**
 * A button that opens a small menu (profile, clinic actions). Closes on
 * Escape, outside click and after an item is chosen; focus returns to the
 * button. Items are ordinary buttons and links, reachable with Tab.
 */
export function Disclosure({
  label,
  trigger,
  children,
  align = "end",
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="emb-disclosure" ref={root}>
      <button
        ref={button}
        type="button"
        className="emb-disclosure__trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
        {/* The name comes from text, not aria-label, so it never conflicts with visible initials (WCAG 2.5.3). */}
        <span className="emb-vh">{label}</span>
      </button>
      {open && <div className={cx("emb-disclosure__panel", `emb-disclosure__panel--${align}`)}>{children(close)}</div>}
    </div>
  );
}
