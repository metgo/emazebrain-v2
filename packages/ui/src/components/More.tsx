/**
 * More building blocks: multi-line field, checkbox, link tabs and a confirm
 * dialog whose buttons say what they do (design doc §7.4).
 */
import { useEffect, useId, useRef, type ReactNode, type Ref, type TextareaHTMLAttributes, type InputHTMLAttributes } from "react";
import { XCircle } from "lucide-react";
import { Button, cx } from "./primitives.tsx";

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode | undefined;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextAreaField({ label, hint, error, id, className, ...rest }: TextAreaFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <div className={cx("emb-field", error ? "emb-field--invalid" : undefined, className)}>
      <label className="emb-field__label" htmlFor={fieldId}>
        {label}
      </label>
      {hint && (
        <p className="emb-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      <textarea
        id={fieldId}
        className="emb-input emb-textarea"
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

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown as a small tag after the label, e.g. "Needed to start sessions". */
  tag?: ReactNode;
}

export function CheckboxField({ label, hint, tag, id, className, ...rest }: CheckboxFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={cx("emb-check", className)}>
      <input id={fieldId} type="checkbox" aria-describedby={hint ? `${fieldId}-hint` : undefined} {...rest} />
      <div className="emb-check__text">
        <label htmlFor={fieldId} className="emb-check__label">
          {label}
          {tag && <span className="emb-check__tag">{tag}</span>}
        </label>
        {hint && (
          <p className="emb-check__hint" id={`${fieldId}-hint`}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export type RenderTabLink = (props: { href: string; className: string; children: ReactNode; "aria-current"?: "page" }) => ReactNode;

/** Navigation tabs (each tab is a link to its own URL), e.g. the tabs inside a patient. */
export function TabNav({ label, tabs, renderLink }: { label: string; tabs: Array<{ href: string; label: ReactNode; active: boolean; badge?: ReactNode }>; renderLink: RenderTabLink }) {
  return (
    <nav className="emb-tabnav" aria-label={label}>
      <ul>
        {tabs.map((t) => (
          <li key={t.href}>
            {renderLink({
              href: t.href,
              className: cx("emb-tabnav__tab", t.active && "is-active"),
              ...(t.active ? { "aria-current": "page" as const } : {}),
              children: (
                <>
                  {t.label}
                  {t.badge}
                </>
              ),
            })}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A modal confirm built on <dialog>: focus is trapped and Escape cancels for
 * free. The confirm button names the action ("Archive patient"), never "OK".
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="emb-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId} className="emb-dialog__title">
        {title}
      </h2>
      {children && <div className="emb-dialog__body">{children}</div>}
      <div className="emb-dialog__actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
