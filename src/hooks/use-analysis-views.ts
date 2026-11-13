import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { tr } from "@/i18n";
import { getAnalysisViews, saveAnalysisViews } from "@/lib/data.functions";
import {
  DEFAULT_VIEWS,
  MAX_VIEWS,
  type AnalysisFilters,
  type AnalysisViews,
  type Section,
} from "@/lib/analysis";

/** Saved analysis views of the signed-in user (server-side, so they follow the account). */
export function useAnalysisViews(userId: string) {
  const qc = useQueryClient();
  const key = ["analysis-views", userId];
  const query = useQuery({ queryKey: key, queryFn: () => getAnalysisViews(), retry: false });
  const save = useMutation({
    mutationFn: (next: AnalysisViews) => saveAnalysisViews({ data: next }),
    onSuccess: (next) => qc.setQueryData(key, next),
    onError: (error: Error) => toast.error(tr(error.message)),
  });
  const current = query.data ?? DEFAULT_VIEWS;
  return {
    ...query,
    data: current,
    saving: save.isPending,
    canAdd: current.views.length < MAX_VIEWS,
    add(name: string, section: Section, filters: AnalysisFilters) {
      const id = crypto.randomUUID();
      save.mutate({
        views: [...current.views, { id, name: name.trim(), section, filters }],
        defaultId: current.defaultId,
      });
      return id;
    },
    update(id: string, patch: { name?: string; section?: Section; filters?: AnalysisFilters }) {
      save.mutate({
        ...current,
        views: current.views.map((view) => (view.id === id ? { ...view, ...patch } : view)),
      });
    },
    remove(id: string) {
      save.mutate({
        views: current.views.filter((view) => view.id !== id),
        defaultId: current.defaultId === id ? null : current.defaultId,
      });
    },
    setDefault(id: string | null) {
      save.mutate({ ...current, defaultId: id });
    },
  };
}
