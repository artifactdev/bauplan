import { tr } from "@/i18n";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex min-w-0 flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl bg-card p-5 shadow-card md:p-6", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type MetricTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  onClick,
  active = false,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: MetricTone;
  icon?: ReactNode;
  onClick?: (() => void) | undefined;
  active?: boolean | undefined;
}) {
  const className = cn(
    "metric-card min-w-0 rounded-xl border p-4 shadow-card md:p-5",
    onClick && "cursor-pointer text-left hover:brightness-105",
    active && "metric-card-active",
  );
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-medium text-muted-foreground">{label}</div>
        {icon && (
          <span aria-hidden="true" className="metric-card-icon shrink-0 rounded-lg p-2">
            {icon}
          </span>
        )}
      </div>
      <div className="metric-card-value mt-3 break-words font-display text-2xl font-semibold tracking-tight tabular md:text-3xl">
        {value}
      </div>
      {hint && <div className="mt-2 text-sm text-muted-foreground">{hint}</div>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={className}
      data-tone={tone}
      aria-pressed={active}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className={className} data-tone={tone}>
      {content}
    </div>
  );
}

const tones = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning-foreground",
  danger: "bg-destructive-subtle text-destructive",
  info: "bg-info-subtle text-info",
  primary: "bg-accent text-accent-foreground",
};

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones | undefined;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Bar({
  value,
  max,
  tone = "primary",
  color,
}: {
  value: number;
  max: number;
  tone?: "primary" | "danger" | "warning";
  color?: "budget" | "planned" | "committed" | "expected" | "paid";
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const fillClass =
    tone === "danger" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          color && tone === "primary" ? "" : fillClass,
        )}
        style={{
          width: `${pct}%`,
          ...(color && tone === "primary" ? { backgroundColor: `var(--finance-${color})` } : {}),
        }}
      />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export const OFFER_STATUS: Record<string, { label: string; tone: keyof typeof tones }> = {
  requested: { label: tr("shared.requested"), tone: "warning" },
  received: { label: tr("shared.received"), tone: "info" },
  accepted: { label: tr("shared.accepted"), tone: "success" },
  rejected: { label: tr("shared.rejected"), tone: "neutral" },
};

export const TASK_STATUS: Record<string, { label: string; tone: keyof typeof tones }> = {
  offen: { label: tr("shared.open"), tone: "neutral" },
  in_arbeit: { label: tr("shared.progress"), tone: "info" },
  erledigt: { label: tr("shared.done"), tone: "success" },
};

export const PRIORITY: Record<string, { label: string; tone: keyof typeof tones }> = {
  niedrig: { label: tr("shared.low"), tone: "neutral" },
  mittel: { label: tr("shared.medium"), tone: "warning" },
  hoch: { label: tr("shared.high"), tone: "danger" },
};
