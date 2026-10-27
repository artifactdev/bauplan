import { useQuery } from "@tanstack/react-query";
import { getTaskAssignees } from "@/lib/data.functions";

export function useTaskAssignees(enabled = true) {
  return useQuery({
    queryKey: ["task-assignees"],
    queryFn: () => getTaskAssignees(),
    enabled,
    staleTime: 60_000,
  });
}
