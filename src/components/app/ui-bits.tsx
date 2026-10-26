import { tr } from "@/i18n";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string | undefined; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-card md:p-5", className)}>
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

const tones = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/25 text-warning-foreground dark:text-warning",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-info/12 text-info",
  primary: "bg-accent text-accent-foreground",
};

export function Pill({ tone = "neutral", children }: { tone?: keyof typeof tones | undefined; children: ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Bar({ value, max, tone = "primary" }: { value: number; max: number; tone?: "primary" | "danger" | "warning" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = tone === "danger" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export const OFFER_STATUS: Record<string, { label: string; tone: keyof typeof tones }> = {
  requested: { label: tr("Angefragt"), tone: "warning" },
  received: { label: tr("Erhalten"), tone: "info" },
  accepted: { label: tr("Angenommen"), tone: "success" },
  rejected: { label: tr("Abgelehnt"), tone: "neutral" },
};

export const TASK_STATUS: Record<string, { label: string; tone: keyof typeof tones }> = {
  offen: { label: tr("Offen"), tone: "neutral" },
  in_arbeit: { label: tr("In Arbeit"), tone: "info" },
  erledigt: { label: tr("Erledigt"), tone: "success" },
};

export const PRIORITY: Record<string, { label: string; tone: keyof typeof tones }> = {
  niedrig: { label: tr("Niedrig"), tone: "neutral" },
  mittel: { label: tr("Mittel"), tone: "warning" },
  hoch: { label: tr("Hoch"), tone: "danger" },
};
