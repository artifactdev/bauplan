import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ContactRound, Globe, Mail, MapPin, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { eur } from "@/lib/format";
import { tradeName, tradeOptions } from "@/lib/options";
import { downloadContactVCard } from "@/lib/vcard";
import type { Workspace } from "@/lib/schema";
import { Empty, OFFER_STATUS, PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { EntityDialog, type Field } from "@/components/app/EntityDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_ws/kontakte")({
  head: () => ({
    meta: [
      { title: tr("contacts.contacts_bauplan") },
      { name: "description", content: tr("contacts.contact_details_tradespeople_companies") },
      { property: "og:title", content: tr("contacts.contacts_bauplan") },
      { property: "og:description", content: tr("contacts.manage_tradesperson_contacts_quotes") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContactsPage,
});

const fields = (ws: Workspace): Field[] => [
  { name: "name", label: tr("contacts.contact_person"), required: true },
  { name: "company", label: tr("shared.company") },
  { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
  { name: "phone", label: tr("contacts.phone") },
  { name: "email", label: tr("shared.email") },
  { name: "website", label: tr("contacts.website") },
  { name: "address", label: tr("shared.address"), full: true },
  { name: "notes", label: tr("shared.notes"), type: "textarea" },
];

const ALL = "__all";

function ContactsPage() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const [dlg, setDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(null);
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState(ALL);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ws.contacts
      .filter((c) => trade === ALL || c.trade_id === trade)
      .filter((c) => !s || [c.name, c.company, c.email, c.phone, c.notes].some((x) => x?.toLowerCase().includes(s)))
      .sort((a, b) => (a.company ?? a.name).localeCompare(b.company ?? b.name, "de"));
  }, [ws.contacts, q, trade]);

  return (
    <>
      <PageHeader
        title={tr("shared.contacts")}
        subtitle={tr("contacts.tradespeople_companies_contacts_selectable")}
        actions={<Button size="sm" onClick={() => setDlg({ initial: {} })}><Plus className="h-4 w-4" /> {tr("contacts.create_contact")}</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder={tr("shared.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={trade} onValueChange={setTrade}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr("shared.all_trades")}</SelectItem>
            {tradeOptions(ws).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => {
          const offers = ws.offers.filter((o) => o.contact_id === c.id);
          const web = c.website ? (/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`) : null;
          return (
            <Panel key={c.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.company ?? c.name}</div>
                  {c.company && <div className="text-sm text-muted-foreground">{c.name}</div>}
                  {c.trade_id && <div className="mt-1"><Pill tone="primary">{tradeName(ws, c.trade_id)}</Pill></div>}
                </div>
                <div className="flex shrink-0">
                  <Button size="icon" variant="ghost" aria-label={tr("shared.edit")} onClick={() => setDlg({ id: c.id, initial: { ...c } })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={tr("shared.delete")} onClick={() => confirm(tr("contacts.delete_contact")) && remove.mutate({ table: "contacts", id: c.id })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="mt-3 grid gap-1 text-sm">
                {c.phone && <a className="flex items-center gap-2 hover:text-primary" href={`tel:${c.phone}`}><Phone className="h-3.5 w-3.5" />{c.phone}</a>}
                {c.email && <a className="flex items-center gap-2 truncate hover:text-primary" href={`mailto:${c.email}`}><Mail className="h-3.5 w-3.5" />{c.email}</a>}
                {web && <a className="flex items-center gap-2 truncate hover:text-primary" href={web} target="_blank" rel="noreferrer"><Globe className="h-3.5 w-3.5" />{c.website}</a>}
                {c.address && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{c.address}</div>}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  try {
                    downloadContactVCard(c);
                  } catch (error) {
                    console.error("Could not export contact", error);
                    toast.error(tr("exportFailed", { ns: "contacts" }));
                  }
                }}
              >
                <ContactRound data-icon="inline-start" />
                {tr("saveToPhone", { ns: "contacts" })}
              </Button>
              {c.notes && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{c.notes}</p>}
              {offers.length > 0 && (
                <div className="mt-3 grid gap-1 border-t pt-2 text-xs">
                  {offers.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{o.title ?? "Angebot"}</span>
                      <span className="flex items-center gap-2">{o.status !== "requested" && <span className="tabular">{eur(o.amount)}</span>}<Pill tone={OFFER_STATUS[o.status]?.tone}>{OFFER_STATUS[o.status]?.label}</Pill></span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
      {!list.length && <Empty>{tr("contacts.no_contacts_yet")}</Empty>}
      <EntityDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.id ? tr("contacts.edit_contact") : tr("shared.new_contact")}
        fields={fields(ws)}
        initial={dlg?.initial}
        onSubmit={(v) => (dlg?.id ? update.mutateAsync({ table: "contacts", id: dlg.id, patch: v }) : create.mutateAsync({ table: "contacts", row: v }))}
      />
    </>
  );
}
