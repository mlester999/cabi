import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Shared surface, form, badge, and layout primitives.
 *
 * Every one of these is a thin wrapper over a semantic class in
 * `styles/tokens.css`. That indirection is deliberate: the class holds the visual
 * contract (radius, border, surface, focus ring), and the component makes it
 * reusable. A page that composes these cannot drift, because it never restates a
 * colour or a radius.
 */

/* ---------------------------------------------------------------------------
 * Surface
 * ------------------------------------------------------------------------- */

export function Card({
  className,
  interactive = false,
  selected = false,
  tone,
  ...props
}: React.ComponentProps<"div"> & {
  /** Adds the hover lift. Use for anything clickable. */
  interactive?: boolean;
  /** The one glow, for the focused item in a list. */
  selected?: boolean;
  /** A feedback surface. Danger and warning also announce themselves. */
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "cabi-card",
        interactive && "cabi-card-interactive",
        selected && "cabi-card-selected",
        tone === "success" && "cabi-surface-success",
        tone === "warning" && "cabi-surface-warning",
        tone === "danger" && "cabi-surface-danger",
        className,
      )}
      {...props}
    />
  );
}

/** An inset inside a card: a row, a field group, a nested panel. */
export function Inset({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("cabi-inset", className)} {...props} />;
}

/** The frosted surface used by overlays and floating chrome. */
export function Glass({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("cabi-glass", className)} {...props} />;
}

/* ---------------------------------------------------------------------------
 * Form controls
 * ------------------------------------------------------------------------- */

/**
 * A labelled control.
 *
 * Rendered as a `<label>` wrapping the control, which is what actually binds the
 * two: the previous version emitted a bare `<label for="...">` and relied on every
 * call site remembering to pass a matching `id`, so most fields in the app had a
 * label that was not associated with anything and could not be reached by clicking
 * or by an assistive technology.
 */
export function Field({
  label,
  help,
  error,
  className,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      {/* Styled as an inline span, but the text is a direct child of the label so
          the accessible name and a click both resolve to the wrapped control. */}
      <span className="cabi-label" style={{ display: "inline" }}>{label}</span>
      <span className="mt-2 block">{children}</span>
      {help && !error ? <span className="cabi-help">{help}</span> : null}
      {error ? <span role="alert" className="cabi-error-text">{error}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn("cabi-input cabi-focus", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("cabi-textarea cabi-focus", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn("cabi-select cabi-focus", className)} {...props} />;
}

/**
 * A switch.
 *
 * A real `<button role="switch">` rather than a styled checkbox, because a toggle
 * that is visually a switch but announces itself as a checkbox is worse than
 * either. Its two sizes match the form controls it sits beside.
 */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  className,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Accessible name. Rendered visually by the caller. */
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-state={checked ? "on" : "off"}
      onClick={() => onCheckedChange(!checked)}
      className={cn("cabi-switch cabi-focus disabled:opacity-45", className)}
    />
  );
}

/* ---------------------------------------------------------------------------
 * Badge
 * ------------------------------------------------------------------------- */

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "primary" | "success" | "warning" | "danger" }) {
  return (
    <span
      className={cn(
        "cabi-badge",
        tone === "primary" && "cabi-badge-primary",
        tone === "success" && "cabi-badge-success",
        tone === "warning" && "cabi-badge-warning",
        tone === "danger" && "cabi-badge-danger",
        className,
      )}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------------------
 * Typography + section furniture
 * ------------------------------------------------------------------------- */

export function PageHeader({
  overline,
  title,
  description,
  actions,
  className,
}: {
  overline?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {overline ? <p className="cabi-overline">{overline}</p> : null}
        <h1 className={cn("cabi-h1 text-white", overline && "mt-1.5")}>{title}</h1>
        {description ? <p className="cabi-body-sm mt-2 max-w-2xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A titled block inside a page. Same card, same header rhythm, every time. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("cabi-card p-5 sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="cabi-h3 text-white">{title}</h2>
          {description ? <p className="cabi-caption mt-1 max-w-2xl">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Empty state
 * ------------------------------------------------------------------------- */

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("cabi-inset px-6 py-10 text-center", className)}>
      {icon ? (
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] text-[var(--cabi-primary)]">
          {icon}
        </span>
      ) : null}
      <p className={cn("text-sm font-semibold text-white", icon && "mt-4")}>{title}</p>
      {description ? <p className="cabi-caption mx-auto mt-2 max-w-sm">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Status card: connection results, capability reports
 * ------------------------------------------------------------------------- */

export function StatusCard({
  tone,
  title,
  detail,
  advanced,
  className,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  title: string;
  /** One line. Anything longer belongs in `advanced`. */
  detail?: string;
  /** Developer diagnostics, collapsed. Never in the normal view. */
  advanced?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "cabi-inset p-4",
        tone === "success" && "cabi-surface-success",
        tone === "warning" && "cabi-surface-warning",
        tone === "danger" && "cabi-surface-danger",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            tone === "success" ? "bg-[var(--cabi-success)]"
              : tone === "warning" ? "bg-[var(--cabi-warning)]"
              : tone === "danger" ? "bg-[var(--cabi-danger)]"
              : "bg-[var(--cabi-text-muted)]",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{title}</p>
          {detail ? <p className="cabi-caption mt-1">{detail}</p> : null}
          {advanced ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-[var(--cabi-text-muted)] hover:text-[var(--cabi-text-secondary)]">
                Advanced details
              </summary>
              <pre className="cabi-caption mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]">{advanced}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Locked / future feature
 * ------------------------------------------------------------------------- */

/**
 * A future feature, presented as intentional.
 *
 * There is no disabled button and no fake data: the card simply is not
 * interactive yet, and says so with a lock and the "In the works" label.
 */
export function LockedCard({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("cabi-locked p-3.5", className)}>
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] text-[var(--cabi-text-muted)]">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--cabi-text-secondary)]">{title}</p>
          {description ? <p className="cabi-caption mt-1">{description}</p> : null}
        </div>
        <Badge className="shrink-0">In the works</Badge>
      </div>
    </div>
  );
}
