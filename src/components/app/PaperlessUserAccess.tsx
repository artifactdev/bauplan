import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getPaperlessUserAccess, setPaperlessUserAccess } from "@/lib/data.functions";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PaperlessError } from "./paperless-ui";

export function PaperlessUserAccess({
  userId,
  role,
  name,
}: {
  userId: string;
  role: string;
  name: string;
}) {
  const { t } = useTranslation("paperless");
  const client = useQueryClient();
  const access = useQuery({
    queryKey: ["paperless-user-access"],
    queryFn: () => getPaperlessUserAccess(),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) => setPaperlessUserAccess({ data: { userId, enabled } }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["paperless-user-access"] }),
        client.invalidateQueries({ queryKey: ["paperless"] }),
      ]);
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Switch
          id={`paperless-access-${userId}`}
          aria-label={t("userAccessLabel", { name })}
          checked={role === "admin" || (role === "member" && !!access.data?.includes(userId))}
          disabled={
            role === "admin" ||
            role === "pending" ||
            access.isPending ||
            access.isError ||
            save.isPending
          }
          onCheckedChange={(enabled) => {
            if (enabled || window.confirm(t("revokeAccessConfirm"))) save.mutate(enabled);
          }}
        />
        <Label htmlFor={`paperless-access-${userId}`}>{t("userAccess")}</Label>
      </div>
      {role === "admin" && <p className="text-xs text-muted-foreground">{t("adminAccess")}</p>}
      <PaperlessError error={access.error ?? save.error} />
      {access.isError && (
        <Button variant="outline" size="sm" onClick={() => access.refetch()}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
