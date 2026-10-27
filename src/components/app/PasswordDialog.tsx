import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { tr } from "@/i18n";
import { changeOwnPassword, getOwnPasswordState } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const EMPTY = { current: "", password: "", repeat: "" };

export function PasswordDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const state = useQuery({ queryKey: ["own-password"], queryFn: () => getOwnPasswordState() });
  const save = useMutation({
    mutationFn: () =>
      changeOwnPassword({ data: { current: form.current, password: form.password } }),
    onSuccess: () => {
      toast.success(tr("settings.password_changed"));
      setForm(EMPTY);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["own-password"] });
    },
    onError: (error: Error) => toast.error(tr(error.message)),
  });
  const changeOpen = (next: boolean) => {
    if (save.isPending) return;
    setOpen(next);
    if (!next) setForm(EMPTY);
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <KeyRound data-icon="inline-start" />
          {tr("settings.change_password")}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{tr("settings.change_password")}</DialogTitle>
        </DialogHeader>
        {state.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {tr("settings.password_state_failed")}
          </p>
        ) : state.data ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (form.password !== form.repeat) {
                toast.error(tr("setup.passwords_not_match"));
                return;
              }
              save.mutate();
            }}
          >
            {!state.data.hasPassword && (
              <p className="text-sm text-muted-foreground">{tr("settings.no_local_password")}</p>
            )}
            <fieldset disabled={save.isPending} className="grid gap-3">
              {state.data.hasPassword && (
                <div className="grid gap-1.5">
                  <Label htmlFor="pw-current">{tr("settings.current_password")}</Label>
                  <Input
                    id="pw-current"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={form.current}
                    onChange={(event) => setForm({ ...form, current: event.target.value })}
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="pw-new">{tr("settings.new_password_min_8")}</Label>
                <Input
                  id="pw-new"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pw-repeat">{tr("setup.repeat_password")}</Label>
                <Input
                  id="pw-repeat"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={form.repeat}
                  onChange={(event) => setForm({ ...form, repeat: event.target.value })}
                />
              </div>
            </fieldset>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => changeOpen(false)}
              >
                {tr("entity_dialog.cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {tr("settings.change_password")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {tr("settings.password_state_loading")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
