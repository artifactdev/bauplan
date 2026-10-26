import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  Copy,
  Database,
  Download,
  KeyRound,
  LogOut,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
import { PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createManagedUser, deleteManagedUser, getCalendarFeed, setCalendarFeed, getOidcAdmin, listUsers, saveOidcAdmin, setUserPassword, setUserRole, type ManagedUser,
} from "@/lib/auth.functions";
import { importBackup } from "@/lib/data.functions";
import { signOut } from "./route";
import { LanguageSelect } from "@/components/app/LanguageSelect";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { OcrSettingsPanel } from "@/components/app/OcrSettingsPanel";
import { AppearancePanel } from "@/components/app/AppearanceControls";
import { NavigationPanel } from "@/components/app/NavigationPanel";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_ws/einstellungen")({
  head: () => ({
    meta: [
      { title: tr("Einstellungen – Bauplan") },
      { name: "description", content: tr("Speicherort, Benutzer und Anmeldung verwalten.") },
      { property: "og:title", content: tr("Einstellungen – Bauplan") },
      { property: "og:description", content: tr("Speicherort, Benutzer und Anmeldung verwalten.") },
    ],
  }),
  component: SettingsPage,
});

const ROLE_LABEL = { admin: "Admin", member: "Mitglied", pending: "Wartet" } as const;

function SettingsPage() {
  const { t } = useTranslation("shell");
  const { backend, auth } = Route.useRouteContext();
  const isAdmin = auth.user?.role === "admin";
  const [tab, setTab] = useState("personal");
  return (
    <>
      <PageHeader title={tr("Einstellungen")} subtitle={t("settingsHint")} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={tr("Einstellungen")} className="mb-5 flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="personal" className="min-h-11 whitespace-normal text-left">{t("personal")}</TabsTrigger>
          <TabsTrigger value="project" className="min-h-11 whitespace-normal text-left">{t("project")}</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin" className="min-h-11 whitespace-normal text-left">{t("administration")}</TabsTrigger>}
        </TabsList>
      <TabsContent value="personal" forceMount hidden={tab !== "personal"}>
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
          <AppearancePanel />
          <div className="grid min-w-0 gap-5">
            <Panel title={tr("Konto")}>
              <p className="text-sm">{auth.user?.name || auth.user?.email}</p>
              <p className="mb-3 text-xs text-muted-foreground">{auth.user?.email} · {tr(ROLE_LABEL[auth.user?.role ?? "member"])}</p>
              <Button variant="outline" onClick={() => signOut()}><LogOut className="h-4 w-4" /> {tr("Abmelden")}</Button>
            </Panel>
            <Panel title={tr("Sprache")}>
              <LanguageSelect />
              <p className="mt-2 text-xs text-muted-foreground">{tr("Die Sprache wird in diesem Browser gespeichert.")}</p>
            </Panel>
          </div>
          <NavigationPanel userId={auth.user!.id} />
        </div>
      </TabsContent>
      <TabsContent value="project" forceMount hidden={tab !== "project"}>
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
          <Panel title={tr("Datenspeicher")}>
            <div className="flex gap-3 rounded-lg border border-primary bg-accent/40 p-3">
              <Database className="h-5 w-5 shrink-0 text-primary" />
              <div className="flex-1">
                <div className="font-medium">{tr("SQLite (selbst gehostet)")}</div>
                <p className="text-sm text-muted-foreground">{tr("Daten werden lokal in SQLite gespeichert.")}</p>
                <p className="mt-2 text-xs text-muted-foreground">{tr("Datenbank:")} <code>{backend.dataDir}</code></p>
                <p className="text-xs text-muted-foreground">{tr("Dokumente:")} <code>{backend.uploadsDir}</code></p>
              </div>
            </div>
          </Panel>
          <PaymentSourcesPanel />
        </div>
      </TabsContent>
      {isAdmin && (
        <TabsContent value="admin" forceMount hidden={tab !== "admin"}>
          <div className="grid min-w-0 gap-5 md:grid-cols-2">
            <UsersPanel selfId={auth.user!.id} />
            <BackupPanel />
            <CalendarFeedPanel />
            <OidcPanel />
            <OcrSettingsPanel />
          </div>
        </TabsContent>
      )}
      </Tabs>
    </>
  );
}

function BackupPanel() {
  const [file, setFile] = useState<File | null>(null);
  const download = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/backup/export");
      if (!response.ok) throw new Error(await response.text());
      return response.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(tr("Backup erfolgreich heruntergeladen."));
    },
    onError: (error: Error) => toast.error(tr(error.message)),
  });
  const restore = useMutation({
    mutationFn: (data: FormData) => importBackup({ data }),
    onSuccess: () => {
      toast.success(
        tr(
          "Backup wurde wiederhergestellt. Bitte melde dich mit einem Konto aus dem Backup erneut an.",
        ),
      );
      window.location.href = "/auth";
    },
    onError: (error: Error) => toast.error(tr(error.message)),
  });

  function submitRestore(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error(tr("Wähle eine gültige Bauplan-Backup-Datei aus."));
      return;
    }
    if (file.size > 128 * 1024 * 1024) {
      toast.error(tr("Das Backup ist größer als 128 MB."));
      return;
    }
    if (!window.confirm(tr("Vorhandene Daten wirklich vollständig ersetzen?"))) return;
    const data = new FormData();
    data.set("file", file);
    data.set("confirm", "replace");
    restore.mutate(data);
  }

  return (
    <Panel title={tr("Backup und Wiederherstellung")} className="md:col-span-2">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <p className="text-sm text-muted-foreground">
            {tr(
              "Ein vollständiges Backup mit Datenbank und allen Dokumenten herunterladen. Es enthält Benutzerkonten und vertrauliche Einstellungen, aber keine aktiven Sitzungen.",
            )}
          </p>
          <Button onClick={() => download.mutate()} disabled={download.isPending}>
            <Download className="h-4 w-4" />
            {download.isPending ? tr("Backup wird erstellt…") : tr("Backup exportieren")}
          </Button>
        </div>
        <form onSubmit={submitRestore} className="grid content-start gap-3">
          <p className="text-sm text-muted-foreground">
            {tr(
              "Der Import ersetzt alle aktuellen Daten und Dokumente. Benutzerkonten und Einstellungen aus dem Backup werden übernommen; alle Nutzer müssen sich erneut anmelden.",
            )}
          </p>
          <Label htmlFor="settings-backup">{tr("Backup-Datei (.zip)")}</Label>
          <Input
            id="settings-backup"
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
          <Button type="submit" variant="outline" disabled={restore.isPending || !file}>
            <Upload className="h-4 w-4" />
            {restore.isPending ? tr("Wird wiederhergestellt…") : tr("Backup wiederherstellen")}
          </Button>
        </form>
      </div>
    </Panel>
  );
}

function CalendarFeedPanel() {
  const qc = useQueryClient();
  const feed = useQuery({ queryKey: ["ics"], queryFn: () => getCalendarFeed() });
  const set = useMutation({
    mutationFn: (action: "create" | "disable") => setCalendarFeed({ data: { action } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ics"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const token = feed.data?.token;
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/api/public/calendar/${token}.ics` : "";
  return (
    <Panel title={tr("Kalender-Abo (iCal)")} className="md:col-span-2">
      <p className="mb-3 text-sm text-muted-foreground">
        Termine und offene Aufgaben mit Fälligkeit als Link abonnieren – z. B. in Google Kalender, Outlook oder Apple Kalender. Nur lesend; wer den Link kennt, sieht die Termine.
      </p>
      {token ? (
        <div className="grid gap-2">
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(url); toast.success(tr("Link kopiert")); }}><Copy className="h-4 w-4" /> {tr("Kopieren")}</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => confirm(tr("Neuen Link erzeugen? Der alte Link funktioniert dann nicht mehr.")) && set.mutate("create")}>{tr("Neuen Link erzeugen")}</Button>
            <Button variant="ghost" size="sm" onClick={() => confirm(tr("Kalender-Abo deaktivieren?")) && set.mutate("disable")}>{tr("Deaktivieren")}</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => set.mutate("create")} disabled={set.isPending || feed.isLoading}><CalendarDays className="h-4 w-4" /> {tr("Link erzeugen")}</Button>
      )}
    </Panel>
  );
}

function UsersPanel({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const onError = (e: Error) => toast.error(e.message);
  const role = useMutation({ mutationFn: (v: { id: string; role: ManagedUser["role"] }) => setUserRole({ data: v }), onSuccess: refresh, onError });
  const del = useMutation({ mutationFn: (id: string) => deleteManagedUser({ data: { id } }), onSuccess: refresh, onError });
  const pw = useMutation({ mutationFn: (v: { id: string; password: string }) => setUserPassword({ data: v }), onSuccess: () => toast.success(tr("Passwort geändert")), onError });
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "member" as "admin" | "member" });
  const add = useMutation({
    mutationFn: () => createManagedUser({ data: form }),
    onSuccess: () => { toast.success(tr("Benutzer angelegt")); setForm({ name: "", email: "", password: "", role: "member" }); refresh(); },
    onError,
  });

  return (
    <Panel title={tr("Benutzer")} className="md:col-span-2">
      <p className="mb-3 text-sm text-muted-foreground">{tr("Alle Mitglieder arbeiten gemeinsam am selben Projekt. Wer sich über OIDC zum ersten Mal anmeldet, erscheint hier als „Wartet“ und muss freigeschaltet werden.")}</p>
      <div className="divide-y rounded-lg border">
        {(users.data ?? []).map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{u.name || u.email} {u.id === selfId && <span className="text-muted-foreground">{tr("(du)")}</span>}</div>
              <div className="truncate text-xs text-muted-foreground">{u.email}{u.sso && " · OIDC"}</div>
            </div>
            {u.role === "pending" && <Pill tone="warning">{tr("Wartet")}</Pill>}
            <select
              aria-label={tr("Rolle")}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={u.role}
              disabled={u.id === selfId}
              onChange={(e) => role.mutate({ id: u.id, role: e.target.value as ManagedUser["role"] })}
            >
              <option value="admin">{tr("Admin")}</option>
              <option value="member">{tr("Mitglied")}</option>
              <option value="pending">{tr("Gesperrt / wartet")}</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => {
              const p = window.prompt(tr("Neues Passwort für {{email}} (mind. 8 Zeichen)", { email: u.email }));
              if (p) pw.mutate({ id: u.id, password: p });
            }}>{tr("Passwort")}</Button>
            {u.id !== selfId && (
              <Button variant="ghost" size="icon" aria-label={tr("Löschen")} onClick={() => confirm(`${u.email} löschen?`) && del.mutate(u.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {users.isLoading && <p className="p-3 text-sm text-muted-foreground">{tr("Lädt…")}</p>}
      </div>
      <form className="mt-4 grid gap-3 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Input placeholder={tr("Name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder={tr("E-Mail")} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input placeholder={tr("Passwort (mind. 8)")} type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select aria-label={tr("Rolle")} className="h-9 rounded-md border bg-background px-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "member" })}>
          <option value="member">{tr("Mitglied")}</option>
          <option value="admin">{tr("Admin")}</option>
        </select>
        <Button type="submit" disabled={add.isPending}><UserPlus className="h-4 w-4" /> {tr("Anlegen")}</Button>
      </form>
    </Panel>
  );
}

function OidcPanel() {
  const cur = useQuery({ queryKey: ["oidc"], queryFn: () => getOidcAdmin() });
  const [s, setS] = useState({ enabled: false, label: "", issuer: "", client_id: "", client_secret: "", public_url: "" });
  useEffect(() => {
    if (cur.data) setS({ ...cur.data, client_secret: "" });
  }, [cur.data]);
  const save = useMutation({
    mutationFn: () => saveOidcAdmin({ data: { ...s, client_secret: s.client_secret || undefined } }),
    onSuccess: () => { toast.success(tr("Gespeichert")); cur.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const origin = typeof window !== "undefined" ? (s.public_url || window.location.origin).replace(/\/+$/, "") : "";

  return (
    <Panel title={tr("Anmeldung über OIDC (z. B. Pocket ID)")} className="md:col-span-2">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
          {tr("OIDC-Anmeldung auf der Anmeldeseite anzeigen")}
        </label>
        <div className="grid gap-1.5">
          <Label htmlFor="ol">{tr("Beschriftung des Knopfs")}</Label>
          <Input id="ol" value={s.label} onChange={(e) => setS({ ...s, label: e.target.value })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="oi">{tr("Aussteller-Adresse (Issuer)")}</Label>
            <Input id="oi" placeholder={tr("https://id.example.de")} value={s.issuer} onChange={(e) => setS({ ...s, issuer: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ou">{tr("Öffentliche Adresse dieser App (optional)")}</Label>
            <Input id="ou" placeholder={tr("https://bau.example.de")} value={s.public_url} onChange={(e) => setS({ ...s, public_url: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="oc">{tr("Client-ID")}</Label>
            <Input id="oc" value={s.client_id} onChange={(e) => setS({ ...s, client_id: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="os">{tr("Client-Geheimnis")}</Label>
            <Input id="os" type="password" placeholder={cur.data?.has_secret ? "gespeichert – leer lassen zum Behalten" : ""} value={s.client_secret} onChange={(e) => setS({ ...s, client_secret: e.target.value })} />
          </div>
        </div>
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <KeyRound className="mr-1 inline h-4 w-4" /> In Pocket ID einen neuen OIDC-Client anlegen und als Callback-URL eintragen:{" "}
          <code className="break-all">{origin}/api/oidc/callback</code>
        </p>
        <div><Button type="submit" disabled={save.isPending}>{tr("Speichern")}</Button></div>
      </form>
    </Panel>
  );
}

function PaymentSourcesPanel() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const [name, setName] = useState("");
  const add = async (n: string, deducts: boolean) => { await create.mutateAsync({ table: "budget_pots", row: { name: n, deducts_from_budget: deducts } }); };
  return (
    <Panel title={tr("Zahlungsquellen")}>
      <p className="mb-3 text-xs text-muted-foreground">{tr("Auswählbar bei Ausgaben und Rechnungen. Nur Quellen mit „Vom Gesamtbudget abziehen“ zählen gegen das Budget (z. B. Bank ja, Privat nein).")}</p>
      <ul className="grid gap-2">
        {ws.budget_pots.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-lg border p-2">
            <span className="flex-1 font-medium">{p.name}</span>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {tr("Vom Gesamtbudget abziehen")}
              <Switch checked={p.deducts_from_budget} onCheckedChange={(c) => update.mutate({ table: "budget_pots", id: p.id, patch: { deducts_from_budget: c } })} />
            </label>
            <Button size="icon" variant="ghost" aria-label={tr("Löschen")} onClick={() => confirm(tr("Zahlungsquelle löschen?")) && remove.mutate({ table: "budget_pots", id: p.id })}><Trash2 className="h-4 w-4" /></Button>
          </li>
        ))}
      </ul>
      {!ws.budget_pots.length && (
        <Button className="mt-2" variant="outline" size="sm" onClick={async () => { await add("Bank", true); await add("Privat", false); }}>{tr("Bank und Privat anlegen")}</Button>
      )}
      <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await add(name.trim(), false); setName(""); }}>
        <Input placeholder={tr("Neue Quelle, z. B. Förderung")} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="outline">{tr("Anlegen")}</Button>
      </form>
    </Panel>
  );
}
