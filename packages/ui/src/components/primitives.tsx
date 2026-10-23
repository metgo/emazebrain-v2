/**
 * Small building blocks (design doc §7.4). Every control is at least 44 px
 * tall, has a visible focus ring and gets its text from the caller, so all
 * wording goes through the app's ICU messages (CLAUDE.md invariant 10).
 */
import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle } from "lucide-react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Matches a CSS media query and follows changes. SSR/test safe. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="emb-vh">{children}</span>;
}

// ---------------------------------------------------------------- Button

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "lg";
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({ variant = "primary", size = "md", loading = false, icon, block, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("emb-btn", `emb-btn--${variant}`, size === "lg" && "emb-btn--lg", block && "emb-btn--block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : icon}
      <span>{children}</span>
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx("emb-iconbtn", className)} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------- Fields

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode | undefined;
  /** Shown after the label, e.g. a "Forgot password?" link. */
  labelAside?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, labelAside, id, className, ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cx("emb-field", error ? "emb-field--invalid" : undefined, className)}>
      <div className="emb-field__labelrow">
        <label className="emb-field__label" htmlFor={inputId}>
          {label}
        </label>
        {labelAside}
      </div>
      {hint && (
        <p className="emb-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      <input
        id={inputId}
        className="emb-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...rest}
      />
      {error && (
        <p className="emb-field__error" id={errorId}>
          <XCircle size={16} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One-time code input. A single field (not six boxes) so password managers,
 * paste and screen readers all work (WCAG 3.3.8, §7.6).
 */
export function CodeField(props: Omit<TextFieldProps, "inputMode" | "autoComplete">) {
  return (
    <TextField
      inputMode="numeric"
      autoComplete="one-time-code"
      spellCheck={false}
      dir="ltr"
      className="emb-field--code"
      {...props}
    />
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  /** Hide the label visually (it stays for screen readers). */
  hideLabel?: boolean;
}

export function SelectField({ label, hideLabel, id, className, children, ...rest }: SelectFieldProps) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className={cx("emb-field", "emb-field--select", className)}>
      <label className={cx("emb-field__label", hideLabel && "emb-vh")} htmlFor={selectId}>
        {label}
      </label>
      <span className="emb-select-wrap">
        <select id={selectId} className="emb-select" {...rest}>
          {children}
        </select>
        <ChevronDown size={18} aria-hidden="true" />
      </span>
    </div>
  );
}

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
}

/** A radio group drawn as a segmented control (theme, language, mode). */
export function Segmented<V extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: ReactNode;
  name: string;
  value: V;
  options: SegmentedOption<V>[];
  onChange: (v: V) => void;
}) {
  return (
    <fieldset className="emb-segmented">
      <legend className="emb-field__label">{legend}</legend>
      <div className="emb-segmented__track">
        {options.map((o) => (
          <label key={o.value} className={cx("emb-segmented__option", o.value === value && "is-selected")}>
            <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            {o.icon}
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- Feedback

export type Tone = "info" | "success" | "warning" | "danger";

const toneIcon: Record<Tone, ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

/** Inline or banner message. Danger interrupts (role=alert); the rest are polite. */
export function Alert({ tone = "info", title, children, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <div className={cx("emb-alert", `emb-alert--${tone}`)} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={20} aria-hidden="true" />
      <div className="emb-alert__body">
        {title && <p className="emb-alert__title">{title}</p>}
        {children && <div className="emb-alert__text">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span className="emb-spinner" style={{ inlineSize: size, blockSize: size }} role={label ? "status" : undefined}>
      {label && <span className="emb-vh">{label}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- Display

export function Card({
  children,
  className,
  as: As = "div",
  padded = true,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
  padded?: boolean;
  labelledBy?: string;
}) {
  return (
    <As className={cx("emb-card", padded && "emb-card--padded", className)} aria-labelledby={labelledBy}>
      {children}
    </As>
  );
}

export type ChipTone = "neutral" | "brand" | "warm" | "cold" | "success" | "warning" | "danger";

export function Chip({ tone = "neutral", children, icon }: { tone?: ChipTone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx("emb-chip", `emb-chip--${tone}`)}>
      {icon}
      {children}
    </span>
  );
}

/** Up to two initials, taken from the first and last words of the name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className="emb-avatar" style={{ inlineSize: size, blockSize: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="emb-empty">
      {icon && <div className="emb-empty__icon">{icon}</div>}
      <h2 className="emb-empty__title">{title}</h2>
      {children && <div className="emb-empty__text">{children}</div>}
      {action && <div className="emb-empty__action">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="emb-pagehead">
      <div className="emb-pagehead__text">
        {eyebrow && <div className="emb-pagehead__eyebrow">{eyebrow}</div>}
        <h1 className="emb-pagehead__title">{title}</h1>
        {description && <p className="emb-pagehead__desc">{description}</p>}
      </div>
      {actions && <div className="emb-pagehead__actions">{actions}</div>}
    </header>
  );
}
