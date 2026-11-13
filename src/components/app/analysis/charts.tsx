import type { ComponentProps } from "react";
import { ChartContainer } from "@/components/ui/chart";
import { eur } from "@/lib/format";
import { compactEur } from "./shared";

type TooltipPayload = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
};

/** Tooltip for money charts: colour swatch, series name and exact euro value. */
export function MoneyTooltip({
  active,
  payload,
  label,
  names,
  format = (value: number) => eur(value, true),
  labelOf,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  names?: Record<string, string>;
  format?: (value: number) => string;
  labelOf?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const title = label !== undefined ? (labelOf ? labelOf(String(label)) : String(label)) : null;
  return (
    <div className="grid min-w-32 gap-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl">
      {title && <div className="font-medium">{title}</div>}
      {payload.map((item, index) => (
        <div key={index} className="flex items-center justify-between gap-4 tabular">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <i
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {names?.[String(item.dataKey)] ?? String(item.name ?? "")}
          </span>
          <span className="font-medium text-foreground">{format(Number(item.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}

export const axisMoney = (value: number) => compactEur(value);

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <i
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartBox({
  height = 280,
  children,
}: {
  height?: number;
  children: ComponentProps<typeof ChartContainer>["children"];
}) {
  return (
    <ChartContainer config={{}} className="aspect-auto w-full min-w-0" style={{ height }}>
      {children}
    </ChartContainer>
  );
}
