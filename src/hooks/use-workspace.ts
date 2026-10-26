import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createRow, deleteRow, getWorkspace, updateRow, uploadDocument } from "@/lib/data.functions";
import type { TableName, Workspace } from "@/lib/schema";

const EMPTY: Workspace = { projects: [], trades: [], cost_items: [], offers: [], invoices: [], documents: [], tasks: [], events: [], expenses: [], ideas: [], contacts: [], budget_pots: [], credit_terms: [], credit_repayments: [] };

export function useWorkspace() {
  const q = useQuery({ queryKey: ["ws"], queryFn: () => getWorkspace() as Promise<Workspace> });
  return { ...q, ws: q.data ?? EMPTY };
}

export function useMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["ws"] });
  const onError = (e: Error) => toast.error(e.message);
  const create = useMutation({
    mutationFn: (v: { table: TableName; row: Record<string, unknown> }) => createRow({ data: v }),
    onSuccess: done,
    onError,
  });
  const update = useMutation({
    mutationFn: (v: { table: TableName; id: string; patch: Record<string, unknown> }) => updateRow({ data: v }),
    onSuccess: done,
    onError,
  });
  const remove = useMutation({
    mutationFn: (v: { table: TableName; id: string }) => deleteRow({ data: v }),
    onSuccess: done,
    onError,
  });
  const upload = useMutation({
    mutationFn: (v: { file: File; meta: Record<string, unknown> }) => {
      const fd = new FormData();
      fd.append("file", v.file);
      fd.append("meta", JSON.stringify(v.meta));
      return uploadDocument({ data: fd });
    },
    onSuccess: done,
    onError,
  });
  return { create, update, remove, upload };
}
