import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getNavigation } from "@/lib/data.functions";

export function useNavigation(userId: string) {
  const query = useQuery({
    queryKey: ["navigation", userId],
    queryFn: () => getNavigation(),
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const { refetch } = query;
  useEffect(() => {
    const refresh = () => {
      void refetch();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refetch]);
  return query;
}
