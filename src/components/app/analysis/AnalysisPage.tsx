import { useEffect, useMemo, useRef, useState } from "react";
import { tr } from "@/i18n";
import { useWorkspace } from "@/hooks/use-workspace";
import { useAnalysisViews } from "@/hooks/use-analysis-views";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import {
  DEFAULT_FILTERS,
  SECTIONS,
  buildLedger,
  filterLedger,
  filterOffers,
  filterTasks,
  type AnalysisFilters,
  type Section,
} from "@/lib/analysis";
import { summarize } from "@/lib/calc";
import { todayISO } from "@/lib/format";
import { getOfflineAccount } from "@/lib/offline-store";
import { PageHeader } from "@/components/app/ui-bits";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalysisFiltersBar } from "./AnalysisFiltersBar";
import { AnalysisViewsBar, PRESET_PREFIX } from "./AnalysisViewsBar";
import { analysisPresets } from "@/lib/analysis-presets";
import { BudgetSection } from "./BudgetSection";
import { CreditSection } from "./CreditSection";
import { ExpensesSection } from "./ExpensesSection";
import { OffersSection } from "./OffersSection";
import { OverviewSection } from "./OverviewSection";
import { TasksSection } from "./TasksSection";
import type { AnalysisContext } from "./types";

export type AnalysisSearch = {
  section?: Section | undefined;
  filters?: AnalysisFilters | undefined;
};

export function AnalysisPage({
  search,
  onSearchChange,
}: {
  search: AnalysisSearch;
  onSearchChange: (search: AnalysisSearch) => void;
}) {
  const { ws } = useWorkspace();
  const userId = getOfflineAccount()?.id ?? "";
  const views = useAnalysisViews(userId);
  const assigneesQuery = useTaskAssignees();
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const defaultApplied = useRef(false);

  const hasCredit = ws.credit_terms.length > 0;
  const sections = SECTIONS.filter((section) => section !== "credit" || hasCredit);
  const filters = search.filters ?? DEFAULT_FILTERS;
  const section = search.section && sections.includes(search.section) ? search.section : "overview";
  const change = (next: AnalysisSearch) => onSearchChange(next);

  // Apply the default view once, but never over filters that came from the URL.
  useEffect(() => {
    if (defaultApplied.current || !views.isFetched) return;
    defaultApplied.current = true;
    const view = views.data.views.find((item) => item.id === views.data.defaultId);
    if (view && !search.filters && !search.section) {
      setActiveViewId(view.id);
      change({ section: view.section, filters: view.filters });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.isFetched]);

  const assignees = useMemo(
    () => new Map((assigneesQuery.data ?? []).map((user) => [user.id, user.label])),
    [assigneesQuery.data],
  );
  const context: AnalysisContext = useMemo(() => {
    const ledger = filterLedger(buildLedger(ws, filters.dateBasis), filters);
    return {
      ws,
      filters,
      today: todayISO(),
      summary: summarize(ws),
      ledger,
      offers: filterOffers(ws.offers, filters),
      tasks: filterTasks(ws.tasks, filters),
      assignees,
      goTo: (next) => change({ filters, section: next }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, filters, assignees]);

  const presets = useMemo(() => analysisPresets(ws, todayISO()), [ws]);
  // A preset stays selected only while the current filters still equal it.
  const activeId = (() => {
    const preset = presets.find((item) => `${PRESET_PREFIX}${item.id}` === activeViewId);
    if (!preset) return activeViewId;
    return preset.section === section && JSON.stringify(preset.filters) === JSON.stringify(filters)
      ? activeViewId
      : null;
  })();

  const sectionLabels: Record<Section, string> = {
    overview: tr("analysis.section_overview"),
    budget: tr("shared.budget"),
    expenses: tr("shared.expenses"),
    offers: tr("navigation.quotes"),
    tasks: tr("analysis.section_tasks"),
    credit: tr("shared.loan"),
  };

  return (
    <>
      <PageHeader title={tr("analysis.title")} subtitle={tr("analysis.subtitle")} />
      <div className="mb-4">
        <AnalysisViewsBar
          views={views.data}
          presets={presets.map((preset) => ({
            id: preset.id,
            name: tr(`analysis.preset_${preset.id}`),
            hint: tr(`analysis.preset_${preset.id}_hint`),
          }))}
          activeId={activeId}
          filters={filters}
          section={section}
          canAdd={views.canAdd}
          saving={views.saving}
          onSelect={(id) => {
            setActiveViewId(id);
            const preset = presets.find((item) => `${PRESET_PREFIX}${item.id}` === id);
            const view = preset ?? views.data.views.find((item) => item.id === id);
            if (view) change({ section: view.section, filters: view.filters });
          }}
          onAdd={(name) => setActiveViewId(views.add(name, section, filters))}
          onUpdate={views.update}
          onRemove={(id) => {
            views.remove(id);
            setActiveViewId(null);
          }}
          onDefault={views.setDefault}
        />
      </div>
      <AnalysisFiltersBar
        ws={ws}
        filters={filters}
        onChange={(next) => change({ section, filters: next })}
        assignees={[...assignees.entries()].map(([value, label]) => ({ value, label }))}
      />
      <Tabs
        value={section}
        onValueChange={(value) => change({ filters, section: value as Section })}
      >
        <TabsList
          aria-label={tr("analysis.sections")}
          className="mb-5 flex h-auto w-full justify-start gap-1 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
        >
          {sections.map((item) => (
            <TabsTrigger key={item} value={item} className="min-h-11">
              {sectionLabels[item]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div role="tabpanel" aria-label={sectionLabels[section]}>
        {section === "overview" && <OverviewSection ctx={context} />}
        {section === "budget" && <BudgetSection ctx={context} />}
        {section === "expenses" && <ExpensesSection ctx={context} />}
        {section === "offers" && <OffersSection ctx={context} />}
        {section === "tasks" && <TasksSection ctx={context} />}
        {section === "credit" && <CreditSection ctx={context} />}
      </div>
    </>
  );
}
