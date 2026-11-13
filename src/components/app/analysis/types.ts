import type { summarize } from "@/lib/calc";
import type { AnalysisFilters, LedgerEntry, Section } from "@/lib/analysis";
import type { Offer, Task, Workspace } from "@/lib/schema";

/** Everything a section needs: the workspace plus the already-filtered slices. */
export type AnalysisContext = {
  ws: Workspace;
  filters: AnalysisFilters;
  today: string;
  summary: ReturnType<typeof summarize>;
  /** Expenses and invoices after all filters. */
  ledger: LedgerEntry[];
  offers: Offer[];
  tasks: Task[];
  assignees: Map<string, string>;
  goTo: (section: Section) => void;
};
