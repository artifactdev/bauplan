import { useQuery } from "@tanstack/react-query";
import { getPaperlessSettings, getPaperlessDocuments } from "@/lib/data.functions";
import { getOfflineAccount } from "@/lib/offline-store";

export function usePaperlessSettings() {
  const userId = getOfflineAccount()?.id;
  return useQuery({
    queryKey: ["paperless", userId, "settings"],
    queryFn: () => getPaperlessSettings(),
    enabled: !!userId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function usePaperlessDocuments(enabled: boolean) {
  const userId = getOfflineAccount()?.id;
  return useQuery({
    queryKey: ["paperless", userId, "documents"],
    queryFn: () => getPaperlessDocuments(),
    enabled: !!userId && enabled,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) =>
      enabled &&
      query.state.data?.some(
        (document) =>
          document.job && ["queued", "transferring", "processing"].includes(document.job.state),
      )
        ? 3000
        : false,
    retry: false,
  });
}
