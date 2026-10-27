import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  FileText,
  LayoutGrid,
  List,
  Inbox,
  Send,
  Pencil,
  Plus,
  Trash2,
  ListPlus,
  X,
} from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { eur, fmtDate, todayISO } from "@/lib/format";
import {
  contactLabel,
  contactOptions,
  costItemOptions,
  docOptions,
  tradeName,
  tradeOptions,
} from "@/lib/options";
import type { Offer, Workspace } from "@/lib/schema";
import { Empty, OFFER_STATUS, PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { EntityDialog, type Field } from "@/components/app/EntityDialog";
import { resolveFileUrl } from "@/components/app/doc-open";
import { QuickTask } from "@/components/app/quick-actions";
import { offerDecisionTitle } from "@/lib/offer-deadlines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_ws/angebote")({
  head: () => ({
    meta: [
      { title: tr("quotes.quotes_invoices_bauplan") },
      { name: "description", content: tr("quotes.compare_accept_contractor_quotes") },
      { property: "og:title", content: tr("quotes.quotes_invoices_bauplan") },
      { property: "og:description", content: tr("quotes.compare_contractor_quotes_track") },
    ],
  }),
  component: OffersPage,
});

const offerFields = (ws: Workspace): Field[] => [
  { name: "contact_id", label: tr("quotes.contact"), type: "select", options: contactOptions(ws) },
  { name: "contractor", label: tr("quotes.company_no_contact") },
  { name: "title", label: tr("shared.service") },
  { name: "amount", label: tr("shared.gross_amount"), type: "number" },
  { name: "requested_date", label: tr("quotes.requested"), type: "date" },
  { name: "offer_date", label: tr("quotes.quote_date"), type: "date" },
  { name: "valid_until", label: tr("quotes.valid_until"), type: "date" },
  { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
  {
    name: "cost_item_id",
    label: tr("shared.cost_item"),
    type: "select",
    options: costItemOptions(ws),
  },
  {
    name: "status",
    label: tr("shared.status"),
    type: "select",
    required: true,
    options: Object.entries(OFFER_STATUS).map(([value, s]) => ({ value, label: s.label })),
  },
  {
    name: "document_id",
    label: tr("quotes.pdf_document"),
    type: "select",
    options: docOptions(ws),
  },
  { name: "notes", label: tr("shared.notes"), type: "textarea" },
];

/** Fill contractor from the chosen contact and default a missing amount to 0. */
function normalize(ws: Workspace, v: Record<string, unknown>) {
  const out = { ...v };
  const c = ws.contacts.find((x) => x.id === out["contact_id"]);
  if (c && !String(out["contractor"] ?? "").trim()) out["contractor"] = c.company ?? c.name;
  if (!String(out["contractor"] ?? "").trim()) throw new Error(tr("quotes.enter_contact_company"));
  if (out["amount"] === "" || out["amount"] == null) out["amount"] = 0;
  return out;
}

const ALL = "__all";
type SortKey = "firm" | "title" | "place" | "requested" | "offer" | "amount" | "status";
const COLS: { key: SortKey; label: string }[] = [
  { key: "firm", label: tr("shared.company") },
  { key: "title", label: tr("shared.service") },
  { key: "place", label: tr("quotes.trade_item") },
  { key: "requested", label: tr("shared.requested") },
  { key: "offer", label: tr("shared.quote") },
  { key: "amount", label: tr("shared.amount") },
  { key: "status", label: tr("shared.status") },
];
/** Empty values always sort last-ish (as smallest); strings compare German-aware. */
const cmp = (a: string | number | null, b: string | number | null) =>
  a === b
    ? 0
    : a === null || a === ""
      ? -1
      : b === null || b === ""
        ? 1
        : typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), "de");
const daysSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

function OffersPage() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const [offerDlg, setOfferDlg] = useState<{
    id?: string;
    initial?: Record<string, unknown>;
  } | null>(null);
  const today = todayISO();
  const [q, setQ] = useState("");
  const [decisionTask, setDecisionTask] = useState<Record<string, unknown> | null>(null);
  const prepareDecisionTask = (offer: Offer) =>
    setDecisionTask({
      title: offerDecisionTitle(offer),
      due_date: offer.valid_until ?? null,
      document_id: offer.document_id,
      trade_id: offer.trade_id,
      cost_item_id: offer.cost_item_id,
      status: "offen",
      priority: "mittel",
    });
  const [fStatus, setFStatus] = useState(ALL);
  const [fTrade, setFTrade] = useState(ALL);
  const [fContact, setFContact] = useState(ALL);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "requested", dir: -1 });
  const who = (o: Offer) => {
    const c = ws.contacts.find((x) => x.id === o.contact_id);
    return c ? contactLabel(c) : o.contractor;
  };
  const place = (o: Offer) =>
    ws.cost_items.find((c) => c.id === o.cost_item_id)?.title ??
    (o.trade_id ? tradeName(ws, o.trade_id) : "");
  const sortVal = (o: Offer): string | number | null => {
    switch (sort.key) {
      case "firm":
        return who(o);
      case "title":
        return o.title;
      case "place":
        return place(o);
      case "requested":
        return o.requested_date;
      case "offer":
        return o.offer_date;
      case "amount":
        return o.status === "requested" ? null : Number(o.amount);
      case "status":
        return Object.keys(OFFER_STATUS).indexOf(o.status);
    }
  };
  const offers = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ws.offers.filter(
      (o) =>
        (fStatus === ALL || o.status === fStatus) &&
        (fTrade === ALL || o.trade_id === fTrade) &&
        (fContact === ALL || o.contact_id === fContact) &&
        (!s || [o.contractor, o.title, o.notes, who(o)].some((x) => x?.toLowerCase().includes(s))),
    );
  }, [ws, q, fStatus, fTrade, fContact]);

  // Group offers by cost item (or trade) for side-by-side comparison
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; offers: Offer[] }>();
    for (const o of offers) {
      const key = o.cost_item_id ?? `t-${o.trade_id ?? "none"}`;
      const label = o.cost_item_id
        ? (ws.cost_items.find((c) => c.id === o.cost_item_id)?.title ?? "–")
        : o.trade_id
          ? tradeName(ws, o.trade_id)
          : tr("quotes.no_trade");
      if (!m.has(key)) m.set(key, { label, offers: [] });
      m.get(key)!.offers.push(o);
    }
    return [...m.values()];
  }, [ws, offers]);

  const openDoc = async (docId: string | null) => {
    const d = ws.documents.find((x) => x.id === docId);
    const url = await resolveFileUrl(d?.storage_path ?? null);
    if (url) window.open(url, "_blank");
  };

  return (
    <>
      <PageHeader
        title={tr("quotes.quotes_invoices")}
        subtitle={tr("quotes.accepted_quotes_count_committed")}
      />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setOfferDlg({ initial: { status: "received" } })}>
            <Plus className="h-4 w-4" /> {tr("quotes.add_quote")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOfferDlg({ initial: { status: "requested", requested_date: today } })}
          >
            <Send className="h-4 w-4" /> {tr("quotes.record_request")}
          </Button>
          {ws.offers.some((o) => o.status === "requested") && (
            <span className="text-sm text-muted-foreground">
              {ws.offers.filter((o) => o.status === "requested").length} Anfrage(n) offen
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-56"
            placeholder={tr("shared.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <FilterSelect
            value={fStatus}
            onChange={setFStatus}
            all="Alle Status"
            options={Object.entries(OFFER_STATUS).map(([value, s]) => ({
              value,
              label: s.label,
            }))}
          />
          <FilterSelect
            value={fTrade}
            onChange={setFTrade}
            all="Alle Gewerke"
            options={tradeOptions(ws)}
          />
          <FilterSelect
            value={fContact}
            onChange={setFContact}
            all="Alle Kontakte"
            options={contactOptions(ws)}
          />
          {(q || fStatus !== ALL || fTrade !== ALL || fContact !== ALL) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQ("");
                setFStatus(ALL);
                setFTrade(ALL);
                setFContact(ALL);
              }}
            >
              {tr("shared.reset")}
            </Button>
          )}
          <div className="ml-auto flex rounded-md border">
            <Button
              size="icon"
              variant={view === "cards" ? "secondary" : "ghost"}
              aria-label={tr("quotes.card_view")}
              onClick={() => setView("cards")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant={view === "table" ? "secondary" : "ghost"}
              aria-label={tr("quotes.table_view")}
              onClick={() => setView("table")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {view === "table" && offers.length > 0 && (
          <Panel>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLS.map((c) => (
                      <TableHead key={c.key} className={c.key === "amount" ? "text-right" : ""}>
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() =>
                            setSort((s) => ({
                              key: c.key,
                              dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1,
                            }))
                          }
                        >
                          {c.label}
                          {sort.key === c.key ? (
                            sort.dir === 1 ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      </TableHead>
                    ))}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular">
                  {[...offers]
                    .sort((a, b) => sort.dir * cmp(sortVal(a), sortVal(b)))
                    .map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">{who(o)}</TableCell>
                        <TableCell>{o.title ?? "–"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {ws.cost_items.find((c) => c.id === o.cost_item_id)?.title ??
                            (o.trade_id ? tradeName(ws, o.trade_id) : "–")}
                        </TableCell>
                        <TableCell>{fmtDate(o.requested_date)}</TableCell>
                        <TableCell>{fmtDate(o.offer_date)}</TableCell>
                        <TableCell className="text-right">
                          {o.status === "requested" ? "–" : eur(o.amount, true)}
                        </TableCell>
                        <TableCell>
                          <Pill tone={OFFER_STATUS[o.status]?.tone}>
                            {OFFER_STATUS[o.status]?.label}
                          </Pill>
                          {o.valid_until && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {tr("quotes.valid_until_date", { date: fmtDate(o.valid_until) })}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {o.status === "received" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={tr("quotes.create_decision_task")}
                              onClick={() => prepareDecisionTask(o)}
                            >
                              <ListPlus className="h-4 w-4" />
                            </Button>
                          )}
                          {o.status === "requested" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={tr("quotes.quote_received")}
                              onClick={() =>
                                setOfferDlg({ id: o.id, initial: { ...o, status: "received" } })
                              }
                            >
                              <Inbox className="h-4 w-4" />
                            </Button>
                          )}
                          {o.status === "received" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={tr("quotes.accept")}
                              onClick={() =>
                                update.mutate({
                                  table: "offers",
                                  id: o.id,
                                  patch: { status: "accepted" },
                                })
                              }
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          {o.document_id && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={tr("shared.open_pdf")}
                              onClick={() => openDoc(o.document_id)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={tr("shared.edit")}
                            onClick={() => setOfferDlg({ id: o.id, initial: { ...o } })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={tr("shared.delete")}
                            onClick={() =>
                              confirm(tr("quotes.delete_quote")) &&
                              remove.mutate({ table: "offers", id: o.id })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
        {view === "cards" &&
          groups.map((g) => {
            const priced = g.offers.filter((o) => o.status !== "requested");
            const min = Math.min(...priced.map((o) => Number(o.amount)));
            return (
              <Panel key={g.label} title={g.label}>
                <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.offers.map((o) => (
                    <article
                      key={o.id}
                      className={`flex h-full min-h-72 min-w-0 flex-col rounded-lg border p-4 ${o.status === "accepted" ? "border-success/50 bg-success/5" : o.status === "rejected" ? "opacity-60" : ""}`}
                    >
                      <div className="flex min-w-0 flex-col items-start gap-2">
                        <div className="self-end">
                          <Pill tone={OFFER_STATUS[o.status]?.tone}>
                            {OFFER_STATUS[o.status]?.label}
                          </Pill>
                        </div>
                        <div className="min-w-0">
                          <div className="break-words font-medium">
                            {(() => {
                              const contact = ws.contacts.find((x) => x.id === o.contact_id);
                              return contact ? contactLabel(contact) : o.contractor;
                            })()}
                          </div>
                          <div className="break-words text-xs text-muted-foreground">
                            {o.title ?? "–"} ·{" "}
                            {o.status === "requested"
                              ? `angefragt ${fmtDate(o.requested_date)}${daysSince(o.requested_date) !== null ? ` (${daysSince(o.requested_date) === 0 ? "heute" : `vor ${daysSince(o.requested_date)} Tagen`})` : ""}`
                              : fmtDate(o.offer_date)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-display text-xl font-semibold tabular">
                          {o.status === "requested" ? "–" : eur(o.amount)}
                        </span>
                        {o.status !== "requested" &&
                          priced.length > 1 &&
                          Number(o.amount) === min && (
                            <Pill tone="primary">{tr("quotes.cheapest")}</Pill>
                          )}
                        {o.status !== "requested" &&
                          priced.length > 1 &&
                          Number(o.amount) > min && (
                            <span className="text-xs text-muted-foreground">
                              +{eur(Number(o.amount) - min)}
                            </span>
                          )}
                      </div>
                      {o.valid_until && (
                        <p
                          className={`mt-2 text-sm ${o.status === "received" && o.valid_until < today ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {tr("quotes.valid_until_date", { date: fmtDate(o.valid_until) })}
                        </p>
                      )}
                      <div className="mt-auto flex flex-wrap gap-1 pt-3">
                        {o.status === "received" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={tr("quotes.create_decision_task")}
                            title={tr("quotes.create_decision_task")}
                            onClick={() => prepareDecisionTask(o)}
                          >
                            <ListPlus className="h-4 w-4" />
                          </Button>
                        )}
                        {o.status === "requested" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setOfferDlg({ id: o.id, initial: { ...o, status: "received" } })
                            }
                          >
                            <Inbox className="h-3.5 w-3.5" /> {tr("quotes.quote_received")}
                          </Button>
                        )}
                        {o.status !== "accepted" && o.status !== "requested" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              update.mutate({
                                table: "offers",
                                id: o.id,
                                patch: { status: "accepted" },
                              })
                            }
                          >
                            <Check className="h-3.5 w-3.5" /> {tr("quotes.accept")}
                          </Button>
                        )}
                        {(o.status === "received" || o.status === "requested") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              update.mutate({
                                table: "offers",
                                id: o.id,
                                patch: { status: "rejected" },
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5" /> {tr("quotes.reject")}
                          </Button>
                        )}
                        {o.document_id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={tr("shared.open_pdf")}
                            onClick={() => openDoc(o.document_id)}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={tr("shared.edit")}
                          onClick={() => setOfferDlg({ id: o.id, initial: { ...o } })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={tr("shared.delete")}
                          onClick={() =>
                            confirm(tr("quotes.delete_quote")) &&
                            remove.mutate({ table: "offers", id: o.id })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </Panel>
            );
          })}
        {!offers.length && (
          <Empty>
            {ws.offers.length
              ? tr("quotes.no_quotes_match_filters")
              : tr("quotes.no_quotes_recorded_yet")}
          </Empty>
        )}
      </div>

      <EntityDialog
        open={!!offerDlg}
        onOpenChange={(o) => !o && setOfferDlg(null)}
        title={offerDlg?.id ? tr("quotes.edit_quote") : tr("quotes.new_quote")}
        fields={offerFields(ws)}
        scan="offer"
        initial={offerDlg?.initial}
        onSubmit={(v) =>
          offerDlg?.id
            ? update.mutateAsync({ table: "offers", id: offerDlg.id, patch: normalize(ws, v) })
            : create.mutateAsync({ table: "offers", row: normalize(ws, v) })
        }
      />
      <QuickTask
        open={!!decisionTask}
        initial={decisionTask ?? undefined}
        onOpenChange={(open) => !open && setDecisionTask(null)}
      />
    </>
  );
}

function FilterSelect({
  value,
  onChange,
  all,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  all: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
