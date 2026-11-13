import { DEFAULT_FILTERS, type AnalysisFilters, type Section } from "./analysis";
import { isBankPot } from "./calc";
import type { Workspace } from "./schema";

export type AnalysisPreset = {
  /** Stable id; texts live in `analysis.preset_<id>` and `analysis.preset_<id>_hint`. */
  id: string;
  section: Section;
  filters: AnalysisFilters;
};

const shiftDays = (today: string, days: number) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Ready-made analyses. Relative periods are resolved against `today`, and presets that need
 * data the project does not have (a private payment source, loan terms) are left out.
 */
export function analysisPresets(
  ws: Pick<Workspace, "budget_pots" | "credit_terms">,
  today: string,
): AnalysisPreset[] {
  const year = today.slice(0, 4);
  const make = (
    id: string,
    section: Section,
    filters: Partial<AnalysisFilters> = {},
  ): AnalysisPreset => ({
    id,
    section,
    filters: { ...DEFAULT_FILTERS, ...filters },
  });
  const privatePots = (ws.budget_pots ?? []).filter((pot) => !isBankPot(pot)).map((pot) => pot.id);
  return [
    make("budget_check", "budget", { budgetOnly: true }),
    make("open_payments", "expenses", {
      statuses: ["offen"],
      dateBasis: "due",
      granularity: "week",
    }),
    make("reimbursements", "expenses", { statuses: ["eingereicht", "erstattet", "abgelehnt"] }),
    ...(privatePots.length ? [make("private_advance", "expenses", { potIds: privatePots })] : []),
    make("last_90_days", "expenses", {
      from: shiftDays(today, -90),
      to: today,
      granularity: "week",
    }),
    make("quarterly_report", "expenses", {
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      granularity: "quarter",
    }),
    make("craftsmen", "expenses", { categories: ["Handwerker"] }),
    make("diy_material", "expenses", { categories: ["Baumarkt", "Material", "Werkzeug"] }),
    make("quote_comparison", "offers"),
    make("schedule", "tasks"),
    ...(ws.credit_terms?.length ? [make("loan_costs", "credit")] : []),
  ];
}
