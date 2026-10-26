import { tr } from "@/i18n";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Hammer } from "lucide-react";
import { getAuthState, runSetup } from "@/lib/auth.functions";
import { importSetupBackup } from "@/lib/data.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSelect } from "@/components/app/LanguageSelect";

export const Route = createFileRoute("/setup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: tr("Ersteinrichtung – Bauplan") },
      { name: "description", content: tr("Lege das erste Admin-Konto für Bauplan an.") },
      { property: "og:title", content: tr("Ersteinrichtung – Bauplan") },
      { property: "og:description", content: tr("Lege das erste Admin-Konto für Bauplan an.") },
    ],
  }),
  beforeLoad: async () => {
    const auth = await getAuthState();
    if (!auth.needsSetup) throw redirect({ to: "/" });
  },
  component: SetupPage,
});

function SetupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupImported, setBackupImported] = useState(false);

  async function restoreBackup(e: React.FormEvent) {
    e.preventDefault();
    if (!backupFile) {
      toast.error(tr("Wähle eine gültige Bauplan-Backup-Datei aus."));
      return;
    }
    if (backupFile.size > 128 * 1024 * 1024) {
      toast.error(tr("Das Backup ist größer als 128 MB."));
      return;
    }
    setBackupBusy(true);
    try {
      const form = new FormData();
      form.set("file", backupFile);
      const result = await importSetupBackup({ data: form });
      if (result.users > 0) {
        toast.success(tr("Backup wiederhergestellt. Melde dich mit einem Konto aus dem Backup an."));
        window.location.href = "/auth";
        return;
      }
      setBackupImported(true);
      setBackupFile(null);
      toast.success(tr("Backup ohne Benutzerkonto wiederhergestellt. Lege jetzt das erste Admin-Konto an."));
    } catch (err) {
      toast.error(err instanceof Error ? tr(err.message) : tr("Einrichtung fehlgeschlagen"));
    } finally {
      setBackupBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== password2) { toast.error(tr("Die Passwörter stimmen nicht überein")); return; }
    setBusy(true);
    try {
      await runSetup({ data: { name, email, password } });
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? tr(err.message) : tr("Einrichtung fehlgeschlagen"));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2 font-display text-lg font-semibold">
          <Hammer className="h-5 w-5 text-primary" /> {tr("Bauplan")}
        </div>
        <h1 className="mt-6 text-2xl font-semibold">{tr("Willkommen! Ersteinrichtung")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr("Es gibt noch kein Konto. Lege jetzt das Admin-Konto an. Weitere Personen und die Anmeldung über OIDC (z. B. Pocket ID) richtest du danach in den Einstellungen ein.")}
        </p>
        <section className="mt-6 rounded-lg border p-4">
          <h2 className="font-medium">{tr("Backup vor der Kontoerstellung importieren")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("Du kannst hier ein vollständiges Bauplan-Backup importieren. Enthaltene Benutzerkonten werden übernommen; danach meldest du dich mit einem Konto aus dem Backup an.")}
          </p>
          <form onSubmit={restoreBackup} className="mt-3 grid gap-3">
            <Label htmlFor="setup-backup">{tr("Backup-Datei (.zip)")}</Label>
            <Input
              id="setup-backup"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setBackupFile(e.currentTarget.files?.[0] ?? null)}
            />
            <Button type="submit" variant="outline" disabled={backupBusy || !backupFile}>
              {backupBusy ? tr("Wird wiederhergestellt…") : tr("Backup wiederherstellen")}
            </Button>
          </form>
          {backupImported && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {tr("Backup ohne Benutzerkonto wiederhergestellt. Lege jetzt das erste Admin-Konto an.")}
            </p>
          )}
        </section>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="lang">Sprache / Language</Label>
            <LanguageSelect id="lang" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="n">{tr("Name")}</Label>
            <Input id="n" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="e">{tr("E-Mail")}</Label>
            <Input id="e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p">{tr("Passwort (mind. 8 Zeichen)")}</Label>
            <Input id="p" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p2">{tr("Passwort wiederholen")}</Label>
            <Input id="p2" type="password" required minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>{tr("Admin-Konto anlegen")}</Button>
        </form>
      </div>
    </div>
  );
}
