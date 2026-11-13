import { useState } from "react";
import { ListFilter, RotateCcw, X } from "lucide-react";
import { tr } from "@/i18n";
import {
  DATE_BASES,
  DEFAULT_FILTERS,
  GRANULARITIES,
  NONE,
  activeFilterCount,
  type AnalysisFilters,
} from "@/lib/analysis";
import { fmtDate, todayISO } from "@/lib/format";
import { contactOptions, potOptions, tradeOptions } from "@/lib/options";
import { EXPENSE_CATEGORIES, PHASES, type Workspace } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MultiSelect, type Option } from "./MultiSelect";
import { statusLabels, useLabels } from "./shared";

const shiftDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type Preset = {
  key: string;
  label: string;
  range: { from: string | null; to: string | null } | null;
};

export function AnalysisFiltersBar({
  ws,
  filters,
  onChange,
  assignees,
}: {
  ws: Workspace;
  filters: AnalysisFilters;
  onChange: (filters: AnalysisFilters) => void;
  assignees: Option[];
}) {
  const [expanded, setExpanded] = useState(false);
  const labels = useLabels(ws);
  const project = ws.projects[0];
  const today = todayISO();
  const set = <K extends keyof AnalysisFilters>(key: K, value: AnalysisFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const withNone = (options: Option[]) => [...options, { value: NONE, label: tr("analysis.none") }];

  const presets: Preset[] = [
    { key: "all", label: tr("analysis.preset_all"), range: { from: null, to: null } },
    ...(project?.start_date
      ? [
          {
            key: "project",
            label: tr("analysis.preset_project"),
            range: { from: project.start_date, to: project.end_date ?? null },
          },
        ]
      : []),
    { key: "30", label: tr("analysis.preset_30"), range: { from: shiftDays(-30), to: today } },
    { key: "90", label: tr("analysis.preset_90"), range: { from: shiftDays(-90), to: today } },
    {
      key: "year",
      label: tr("analysis.preset_year"),
      range: { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
    },
  ];
  const activePreset = presets.find(
    (preset) =>
      preset.range && preset.range.from === filters.from && preset.range.to === filters.to,
  );

  const basisLabels = {
    expense: tr("analysis.basis_expense"),
    payment: tr("analysis.basis_payment"),
    due: tr("analysis.basis_due"),
  };
  const granularityLabels = {
    week: tr("analysis.week"),
    month: tr("analysis.month"),
    quarter: tr("analysis.quarter"),
  };
  const status = statusLabels();
  const count = activeFilterCount(filters);
  const moreCount =
    count -
    [filters.from, filters.to].filter(Boolean).length -
    (filters.dateBasis !== DEFAULT_FILTERS.dateBasis ? 1 : 0);

  const chips: { key: string; label: string; clear: () => void }[] = [];
  const addChips = (
    name: string,
    values: string[],
    text: (value: string) => string,
    field: keyof AnalysisFilters,
  ) =>
    values.forEach((value) =>
      chips.push({
        key: `${field}-${value}`,
        label: `${name}: ${text(value)}`,
        clear: () => set(field, values.filter((entry) => entry !== value) as never),
      }),
    );
  addChips(tr("shared.trade"), filters.tradeIds, (value) => labels.trade(value), "tradeIds");
  addChips(
    tr("shared.cost_item"),
    filters.costItemIds,
    (value) => labels.costItem(value),
    "costItemIds",
  );
  addChips(
    tr("shared.category"),
    filters.categories,
    (value) => labels.category(value),
    "categories",
  );
  addChips(tr("shared.paid_2"), filters.potIds, (value) => labels.pot(value), "potIds");
  addChips(tr("shared.status"), filters.statuses, (value) => status[value] ?? value, "statuses");
  addChips(
    tr("analysis.contact"),
    filters.contactIds,
    (value) => labels.contact(value),
    "contactIds",
  );
  addChips(tr("analysis.phase"), filters.phases, (value) => labels.phase(value), "phases");
  addChips(
    tr("analysis.assignee"),
    filters.assigneeIds,
    (value) => assignees.find((a) => a.value === value)?.label ?? tr("analysis.none"),
    "assigneeIds",
  );

  return (
    <section
      aria-label={tr("analysis.filters")}
      className="mb-5 grid gap-3 rounded-xl bg-card p-3 shadow-card ring-1 ring-border/40 sm:p-4"
    >
      <div
        className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden [&>button]:shrink-0"
        role="group"
        aria-label={tr("analysis.period")}
      >
        {presets.map((preset) => (
          <Button
            key={preset.key}
            size="sm"
            variant={activePreset?.key === preset.key ? "secondary" : "ghost"}
            aria-pressed={activePreset?.key === preset.key}
            onClick={() => preset.range && onChange({ ...filters, ...preset.range })}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <div className="grid gap-1">
          <Label htmlFor="analysis-from" className="text-xs text-muted-foreground">
            {tr("analysis.from")}
          </Label>
          <Input
            id="analysis-from"
            type="date"
            value={filters.from ?? ""}
            max={filters.to ?? undefined}
            onChange={(event) => set("from", event.target.value || null)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="analysis-to" className="text-xs text-muted-foreground">
            {tr("analysis.to")}
          </Label>
          <Input
            id="analysis-to"
            type="date"
            value={filters.to ?? ""}
            min={filters.from ?? undefined}
            onChange={(event) => set("to", event.target.value || null)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="analysis-basis" className="text-xs text-muted-foreground">
            {tr("analysis.date_basis")}
          </Label>
          <Select
            value={filters.dateBasis}
            onValueChange={(value) => set("dateBasis", value as AnalysisFilters["dateBasis"])}
          >
            <SelectTrigger id="analysis-basis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_BASES.map((basis) => (
                <SelectItem key={basis} value={basis}>
                  {basisLabels[basis]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="analysis-granularity" className="text-xs text-muted-foreground">
            {tr("analysis.granularity")}
          </Label>
          <Select
            value={filters.granularity}
            onValueChange={(value) => set("granularity", value as AnalysisFilters["granularity"])}
          >
            <SelectTrigger id="analysis-granularity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRANULARITIES.map((granularity) => (
                <SelectItem key={granularity} value={granularity}>
                  {granularityLabels[granularity]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 flex items-end gap-2 lg:col-span-1">
          <Button
            variant="outline"
            className="flex-1 lg:flex-none"
            aria-expanded={expanded}
            aria-controls="analysis-more-filters"
            onClick={() => setExpanded((value) => !value)}
          >
            <ListFilter className="h-4 w-4" aria-hidden="true" /> {tr("analysis.more_filters")}
            {moreCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {moreCount}
              </span>
            )}
          </Button>
          {count > 0 && (
            <Button variant="ghost" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> {tr("shared.reset")}
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div id="analysis-more-filters" className="grid gap-3 border-t pt-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <MultiSelect
              label={tr("shared.trade")}
              options={withNone(tradeOptions(ws))}
              value={filters.tradeIds}
              onChange={(value) => set("tradeIds", value)}
            />
            <MultiSelect
              label={tr("shared.cost_item")}
              options={withNone(
                ws.cost_items.map((item) => ({ value: item.id, label: item.title })),
              )}
              value={filters.costItemIds}
              onChange={(value) => set("costItemIds", value)}
            />
            <MultiSelect
              label={tr("shared.category")}
              options={EXPENSE_CATEGORIES.map((category) => ({
                value: category,
                label: tr(category),
              }))}
              value={filters.categories}
              onChange={(value) => set("categories", value)}
            />
            <MultiSelect
              label={tr("shared.paid_2")}
              options={withNone(potOptions(ws))}
              value={filters.potIds}
              onChange={(value) => set("potIds", value)}
            />
            <MultiSelect
              label={tr("shared.status")}
              options={Object.entries(status).map(([value, label]) => ({ value, label }))}
              value={filters.statuses}
              onChange={(value) => set("statuses", value as AnalysisFilters["statuses"])}
            />
            <MultiSelect
              label={tr("analysis.contact")}
              options={withNone(contactOptions(ws))}
              value={filters.contactIds}
              onChange={(value) => set("contactIds", value)}
            />
            <MultiSelect
              label={tr("analysis.phase")}
              options={PHASES.map((phase) => ({ value: phase, label: tr(phase) }))}
              value={filters.phases}
              onChange={(value) => set("phases", value)}
            />
            <MultiSelect
              label={tr("analysis.assignee")}
              options={withNone(assignees)}
              value={filters.assigneeIds}
              onChange={(value) => set("assigneeIds", value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="analysis-budget-only"
              checked={filters.budgetOnly}
              onCheckedChange={(checked) => set("budgetOnly", checked)}
            />
            <Label htmlFor="analysis-budget-only" className="text-sm">
              {tr("analysis.budget_only")}
              <span className="block text-xs font-normal text-muted-foreground">
                {tr("analysis.budget_only_hint")}
              </span>
            </Label>
          </div>
        </div>
      )}
      {(chips.length > 0 || filters.from || filters.to) && (
        <ul className="flex flex-wrap gap-1.5" aria-label={tr("analysis.active_filters")}>
          {(filters.from || filters.to) && (
            <li className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs text-accent-foreground">
              {fmtDate(filters.from)} – {fmtDate(filters.to)}
            </li>
          )}
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-accent py-1 pl-2.5 pr-1 text-xs text-accent-foreground"
            >
              {chip.label}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background/60"
                aria-label={tr("analysis.remove_filter", { label: chip.label })}
                onClick={chip.clear}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
