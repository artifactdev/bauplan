import { tr } from "@/i18n";
import type { ReactNode } from "react";
import { eur } from "@/lib/format";
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
    <section
      className={cn(
        "min-w-0 rounded-xl bg-card p-4 shadow-card ring-1 ring-border/40 sm:p-5 md:p-6",
        className,
      )}
    >
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
  compact = false,
  muted = false,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: MetricTone;
  icon?: ReactNode;
  onClick?: (() => void) | undefined;
  active?: boolean | undefined;
  compact?: boolean | undefined;
  muted?: boolean | undefined;
}) {
  const className = cn(
    "metric-card min-w-0 rounded-xl border shadow-card",
    compact ? "p-3 md:p-4" : "p-3 sm:p-4 md:p-5",
    onClick && "cursor-pointer text-left hover:brightness-105",
    active && "metric-card-active",
  );
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-medium text-muted-foreground">{label}</div>
        {icon && (
          <span
            aria-hidden="true"
            className="metric-card-icon hidden shrink-0 rounded-lg p-2 sm:block"
          >
            {icon}
          </span>
        )}
      </div>
      <div
        className={cn(
          "metric-card-value break-words font-display font-semibold tracking-tight tabular",
          compact ? "mt-1.5 text-xl" : "mt-2 text-xl sm:mt-3 sm:text-2xl md:text-3xl",
          muted && "opacity-60",
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1.5 text-xs text-muted-foreground sm:mt-2 sm:text-sm">{hint}</div>
      )}
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

/**
 * Budget as one segmented bar: paid | still to pay | free (or a marker where the
 * budget is exceeded). Every segment is also listed with value and share, so the
 * numbers never depend on colour alone.
 */
export function BudgetBreakdown({
  budget,
  expected,
  paid,
}: {
  budget: number;
  expected: number;
  paid: number;
}) {
  const paidAmount = Math.min(Math.max(paid, 0), expected);
  const toPay = Math.max(expected - paidAmount, 0);
  const free = Math.max(budget - expected, 0);
  const over = Math.max(expected - budget, 0);
  const scale = Math.max(budget, expected, 1);
  const width = (value: number) => `${(value / scale) * 100}%`;
  const share = (value: number) => `${Math.round((value / Math.max(budget, 1)) * 100)} %`;
  const rows = [
    {
      key: "paid",
      label: tr("budget.paid_from_budget"),
      value: paidAmount,
      color: "var(--finance-paid)",
    },
    { key: "to-pay", label: tr("budget.to_pay"), value: toPay, color: "var(--finance-expected)" },
    over > 0
      ? { key: "over", label: tr("budget.over"), value: over, color: "var(--destructive)" }
      : { key: "free", label: tr("budget.free"), value: free, color: "var(--muted-foreground)" },
  ];
  return (
    <div>
      <div
        role="img"
        aria-label={rows.map((row) => `${row.label}: ${eur(row.value)}`).join(", ")}
        className="relative flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full"
          style={{ width: width(paidAmount), backgroundColor: rows[0]!.color }}
        />
        <div
          className="h-full rounded-full"
          style={{ width: width(toPay), backgroundColor: rows[1]!.color }}
        />
        {over > 0 && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-foreground"
            style={{ left: width(budget) }}
          />
        )}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm tabular sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key} className="flex min-w-0 items-center gap-2 sm:items-start">
            <i
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full sm:mt-1.5"
              style={{ backgroundColor: row.color, opacity: row.key === "free" ? 0.35 : 1 }}
            />
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2 sm:block">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="font-medium">
                {eur(row.value)}
                {budget > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {share(row.value)}
                  </span>
                )}
              </dd>
            </div>
          </div>
        ))}
      </dl>
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
