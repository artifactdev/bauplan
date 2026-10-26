import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { useNavigation } from "@/hooks/use-navigation";
import { saveNavigation } from "@/lib/data.functions";
import { DEFAULT_NAVIGATION, type NavigationPreferences } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "./ui-bits";
import { navigationItem } from "./navigation-items";

export function NavigationPanel({ userId }: { userId: string }) {
  const { t } = useTranslation("navigation");
  const query = useNavigation(userId);
  const client = useQueryClient();
  const [draft, setDraft] = useState<NavigationPreferences | null>(null);
  const value = draft ?? query.data;
  const save = useMutation({
    mutationFn: (preferences: NavigationPreferences) => saveNavigation({ data: preferences }),
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey: ["navigation", userId] });
      client.setQueryData(["navigation", userId], saved);
      setDraft(null);
      toast.success(t("saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  function move(index: number, direction: number) {
    if (!value) return;
    const order = [...value.order];
    const next = index + direction;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next]!, order[index]!];
    setDraft({ ...value, order });
  }
  return (
    <Panel title={t("title")} className="lg:col-span-2">
      <p className="mb-4 text-sm text-muted-foreground">{t("hint")}</p>
      {query.isError ? (
        <div role="alert">
          <p>{t("loadError")}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !value ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <fieldset disabled={save.isPending} className="min-w-0">
          <legend className="sr-only">{t("title")}</legend>
          <ol className="grid gap-2">
            {value.order.map((path, index) => {
              const item = navigationItem(path);
              const label = item.label();
              return (
                <li key={path} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={!value.hidden.includes(path)}
                      onChange={(event) =>
                        setDraft({
                          ...value,
                          hidden: event.target.checked
                            ? value.hidden.filter((entry) => entry !== path)
                            : [...value.hidden, path],
                        })
                      }
                    />
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="[overflow-wrap:anywhere]">{label}</span>
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("up", { name: label })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("down", { name: label })}
                    disabled={index === value.order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => save.mutate(value)} disabled={!draft}>
              {save.isPending ? t("saving") : t("save")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDraft({ order: [...DEFAULT_NAVIGATION.order], hidden: [] })}
            >
              {t("reset")}
            </Button>
          </div>
        </fieldset>
      )}
    </Panel>
  );
}
