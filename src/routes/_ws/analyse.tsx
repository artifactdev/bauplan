import { lazy, Suspense } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { tr } from "@/i18n";
import {
  DEFAULT_FILTERS,
  SECTIONS,
  analysisFiltersSchema,
  type AnalysisFilters,
} from "@/lib/analysis";

// Charts are heavy: load them only when the analysis page is opened.
const AnalysisPage = lazy(() =>
  import("@/components/app/analysis/AnalysisPage").then((module) => ({
    default: module.AnalysisPage,
  })),
);

export const Route = createFileRoute("/_ws/analyse")({
  head: () => ({
    meta: [
      { title: tr("analysis.title_page") },
      { name: "description", content: tr("analysis.subtitle") },
    ],
  }),
  validateSearch: z.object({
    section: z.enum(SECTIONS).optional().catch(undefined),
    // Only non-default values are kept in the URL, so shared links stay short.
    filters: analysisFiltersSchema.partial().optional().catch(undefined),
  }),
  component: AnalysisRoute,
});

function changedFilters(filters: AnalysisFilters | undefined) {
  if (!filters) return undefined;
  const changed = Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(DEFAULT_FILTERS[key as keyof AnalysisFilters]),
    ),
  );
  return Object.keys(changed).length ? changed : undefined;
}

function resolveFilters(
  partial: z.infer<ReturnType<typeof analysisFiltersSchema.partial>> | undefined,
) {
  if (!partial) return undefined;
  const parsed = analysisFiltersSchema.safeParse({ ...DEFAULT_FILTERS, ...partial });
  return parsed.success ? parsed.data : undefined;
}

function AnalysisRoute() {
  const { section, filters } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          {tr("shared.loading")}
        </p>
      }
    >
      <AnalysisPage
        search={{ section, filters: resolveFilters(filters) }}
        onSearchChange={(next) =>
          void navigate({
            replace: true,
            search: {
              section: next.section && next.section !== "overview" ? next.section : undefined,
              filters: changedFilters(next.filters),
            },
          })
        }
      />
    </Suspense>
  );
}
