import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getNavigation } from "@/lib/data.functions";

export function useNavigation(userId: string) {
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine);
  const query = useQuery({
    queryKey: ["navigation", userId],
    queryFn: () => getNavigation(),
    refetchOnWindowFocus: "always",
    retry: false,
    enabled: online,
  });
  const { refetch } = query;
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const refresh = () => {
      void refetch();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", refresh);
    };
  }, [refetch]);
  return query;
}
