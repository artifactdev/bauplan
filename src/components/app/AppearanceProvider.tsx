import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  APPEARANCE_CACHE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  parseAppearanceCache,
  resolveMode,
  type Appearance,
} from "@/lib/appearance";
import { getAppearance, saveAppearance } from "@/lib/data.functions";
import { Button } from "@/components/ui/button";

type AppearanceContextValue = {
  appearance: Appearance;
  resolvedMode: "light" | "dark";
  saving: boolean;
  setAppearance: (value: Appearance) => void;
  apply: (value: Appearance) => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function readCache() {
  try {
    return parseAppearanceCache(localStorage.getItem(APPEARANCE_CACHE_KEY)) ?? DEFAULT_APPEARANCE;
  } catch (error) {
    console.warn("Appearance browser storage unavailable", error);
    return DEFAULT_APPEARANCE;
  }
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation("appearance");
  const queryClient = useQueryClient();
  const [appearance, setValue] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [prefersDark, setPrefersDark] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const queued = useRef<Appearance | null>(null);
  const current = useRef(appearance);
  const account = useRef<string | null>(null);
  const generation = useRef(0);

  const apply = useCallback((value: Appearance) => {
    current.current = value;
    setValue(value);
    applyAppearance(value, window.matchMedia("(prefers-color-scheme: dark)").matches);
    try {
      localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(value));
    } catch (error) {
      console.warn("Appearance browser storage unavailable", error);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      setPrefersDark(media.matches);
      applyAppearance(current.current, media.matches);
    };
    apply(readCache());
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [apply]);

  const setAppearance = (value: Appearance) => {
    const userId = account.current;
    if (!userId) return;
    const previous = current.current;
    const version = generation.current;
    current.current = value;
    setValue(value);
    applyAppearance(value, window.matchMedia("(prefers-color-scheme: dark)").matches);
    queued.current = value;
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    void (async () => {
      let confirmed = previous;
      try {
        await queryClient.cancelQueries({ queryKey: ["appearance", userId] });
        while (queued.current && version === generation.current) {
          const next = queued.current;
          queued.current = null;
          const saved = await saveAppearance({ data: next });
          if (version !== generation.current) return;
          confirmed = saved;
          queryClient.setQueryData(["appearance", userId], saved);
          if (!queued.current) apply(saved);
        }
      } catch (error) {
        console.error("Could not save appearance", error);
        if (version !== generation.current) return;
        queued.current = null;
        queryClient.setQueryData(["appearance", userId], confirmed);
        apply(confirmed);
        toast.error(t("saveError"));
      } finally {
        if (version === generation.current) {
          busy.current = false;
          queued.current = null;
          setSaving(false);
        }
      }
    })();
  };

  // Account identity is controlled only by the authenticated workspace boundary.
  const bindAccount = useCallback(
    (userId: string | null) => {
      if (account.current === userId) return;
      generation.current++;
      account.current = userId;
      busy.current = false;
      setSaving(false);
      if (!userId) queryClient.removeQueries({ queryKey: ["appearance"] });
    },
    [queryClient],
  );

  return (
    <AppearanceContext.Provider
      value={{
        appearance,
        resolvedMode: resolveMode(appearance.mode, prefersDark),
        saving,
        setAppearance,
        apply,
      }}
    >
      <AccountBindingContext.Provider value={bindAccount}>
        {children}
      </AccountBindingContext.Provider>
    </AppearanceContext.Provider>
  );
}

const AccountBindingContext = createContext<(userId: string | null) => void>(() => {
  throw new Error("AppearanceProvider is missing");
});

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("AppearanceProvider is missing");
  return context;
}

export function AccountAppearance({ userId, children }: { userId: string; children: ReactNode }) {
  const bindAccount = useContext(AccountBindingContext);
  useEffect(() => {
    bindAccount(userId);
    return () => bindAccount(null);
  }, [bindAccount, userId]);
  return <AccountLoader userId={userId}>{children}</AccountLoader>;
}

function AccountLoader({ userId, children }: { userId: string; children: ReactNode }) {
  const { t } = useTranslation("appearance");
  const { apply, saving } = useAppearance();
  const [applied, setApplied] = useState(false);
  const query = useQuery({
    queryKey: ["appearance", userId],
    queryFn: () => getAppearance(),
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    enabled: !saving,
    retry: false,
  });
  const { refetch } = query;
  useEffect(() => {
    const refresh = () => {
      if (!saving) void refetch();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [saving, refetch]);
  useEffect(() => {
    if (query.data && !saving) {
      apply(query.data);
      setApplied(true);
    }
  }, [query.data, saving, apply]);
  if (query.isError)
    return (
      <div role="alert" className="mx-auto max-w-md space-y-3 p-6">
        <p>{t("loadError")}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  if (!applied)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        {t("loading")}
      </p>
    );
  return children;
}
