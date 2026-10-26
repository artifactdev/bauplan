import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Bar as RBar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { summarize } from "@/lib/calc";
import { eur } from "@/lib/format";
import { tradeName } from "@/lib/options";
import { Bar, Empty, PageHeader, Panel } from "@/components/app/ui-bits";
import { EntityDialog } from "@/components/app/EntityDialog";
import { QuickCost } from "@/components/app/quick-actions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_ws/budget")({
  head: () => ({
    meta: [
      { title: tr("Budget – Bauplan") },
      { name: "description", content: tr("Gesamtbudget, Gewerke und Kostenpositionen: geplant, beauftragt und bezahlt im Vergleich.") },
      { property: "og:title", content: tr("Budget – Bauplan") },
      { property: "og:description", content: tr("Gesamtbudget, Gewerke und Kostenpositionen im Vergleich.") },
    ],
  }),
  component: BudgetPage,
});

function BudgetPage() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const s = useMemo(() => summarize(ws), [ws]);
  const project = ws.projects[0];
  const [tradeDlg, setTradeDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(null);
  const [costDlg, setCostDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(null);
  const [budgetDlg, setBudgetDlg] = useState(false);
  const tradeBudgets = ws.trades.reduce((a, t) => a + Number(t.budget), 0);

  const chart = s.trades.map((t) => ({ name: t.name, Budget: t.budget, Voraussichtlich: t.expected, Bezahlt: t.paid }));

  return (
    <>
      <PageHeader
        title={tr("Budget")}
        subtitle={tr("Beauftragt = angenommene Angebote · Bezahlt = bezahlte Rechnungen · Voraussichtlich zählt nichts doppelt")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setTradeDlg({})}><Plus className="h-4 w-4" /> {tr("Gewerk")}</Button>
            <Button size="sm" onClick={() => setCostDlg({})}><Plus className="h-4 w-4" /> {tr("Kostenposition")}</Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={tr("Gesamtbudget")} action={<Button variant="ghost" size="icon" aria-label={tr("Budget bearbeiten")} onClick={() => setBudgetDlg(true)}><Pencil className="h-4 w-4" /></Button>}>
          <div className="font-display text-3xl font-semibold tabular">{eur(s.budget)}</div>
          <div className="mt-3"><Bar value={s.expected} max={s.budget} tone={s.remaining < 0 ? "danger" : "primary"} /></div>
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm tabular">
            <dt className="text-muted-foreground">{tr("Geplant")}</dt><dd className="text-right">{eur(s.planned)}</dd>
            <dt className="text-muted-foreground">{tr("Beauftragt")}</dt><dd className="text-right">{eur(s.committed)}</dd>
            <dt className="text-muted-foreground">{tr("Abgerechnet")}</dt><dd className="text-right">{eur(s.invoiced)}</dd>
            <dt className="text-muted-foreground">{tr("davon Ausgaben (Belege)")}</dt><dd className="text-right">{eur(s.expensesTotal)}</dd>
            <dt className="text-muted-foreground">{tr("Bezahlt")}</dt><dd className="text-right">{eur(s.paid)}</dd>
            <dt className="font-medium">{tr("Voraussichtlich")}</dt><dd className="text-right font-medium">{eur(s.expected)}</dd>
            <dt className="font-medium">{tr("Verbleibend")}</dt><dd className={`text-right font-medium ${s.remaining < 0 ? "text-destructive" : "text-success"}`}>{eur(s.remaining)}</dd>
          </dl>
          {tradeBudgets > s.budget && <p className="mt-3 text-xs text-destructive">Summe der Gewerk-Budgets ({eur(tradeBudgets)}) übersteigt das Gesamtbudget.</p>}
        </Panel>
        <Panel title={tr("Gewerke im Vergleich")} className="lg:col-span-2">
          {chart.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => eur(v)}
                    contentStyle={{ backgroundColor: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }}
                    itemStyle={{ color: "var(--popover-foreground)" }}
                    cursor={{ fill: "var(--muted)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-foreground">{value}</span>} />
                  <RBar dataKey="Budget" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
                  <RBar dataKey="Voraussichtlich" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  <RBar dataKey="Bezahlt" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty>{tr("Lege Gewerke an, um sie zu vergleichen.")}</Empty>
          )}
        </Panel>
      </div>

      <Panel title={tr("Gewerke")} className="mt-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>{tr("Gewerk")}</TableHead><TableHead className="text-right">{tr("Budget")}</TableHead><TableHead className="text-right">{tr("Beauftragt")}</TableHead><TableHead className="text-right">{tr("Bezahlt")}</TableHead><TableHead className="text-right">{tr("Voraussichtlich")}</TableHead><TableHead className="text-right">{tr("Abweichung")}</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody className="tabular">
              {s.trades.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-right">{eur(t.budget)}</TableCell>
                  <TableCell className="text-right">{eur(t.committed)}</TableCell>
                  <TableCell className="text-right">{eur(t.paid)}</TableCell>
                  <TableCell className="text-right">{eur(t.expected)}</TableCell>
                  <TableCell className={`text-right ${t.deviation > 0 ? "text-destructive" : "text-success"}`}>{t.deviation > 0 ? "+" : ""}{eur(t.deviation)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="icon" aria-label={tr("Bearbeiten")} onClick={() => setTradeDlg({ id: t.id, initial: { name: t.name, budget: t.budget } })}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label={tr("Löschen")} onClick={() => confirm(`Gewerk „${t.name}“ löschen?`) && remove.mutate({ table: "trades", id: t.id })}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!s.trades.length && <Empty>{tr("Noch keine Gewerke.")}</Empty>}
        </div>
      </Panel>

      <Panel title={tr("Kostenpositionen")} className="mt-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>{tr("Position")}</TableHead><TableHead>{tr("Gewerk")}</TableHead><TableHead className="text-right">{tr("Geplant")}</TableHead><TableHead className="text-right">{tr("Beauftragt")}</TableHead><TableHead className="text-right">{tr("Abgerechnet")}</TableHead><TableHead className="text-right">{tr("Bezahlt")}</TableHead><TableHead className="text-right">{tr("Voraussichtlich")}</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody className="tabular">
              {s.items.map((i) => {
                const c = ws.cost_items.find((x) => x.id === i.id)!;
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.title}</TableCell>
                    <TableCell className="text-muted-foreground">{tradeName(ws, i.trade_id)}</TableCell>
                    <TableCell className="text-right">{eur(i.planned)}</TableCell>
                    <TableCell className="text-right">{i.committed ? eur(i.committed) : "–"}</TableCell>
                    <TableCell className="text-right">{i.invoiced ? eur(i.invoiced) : "–"}</TableCell>
                    <TableCell className="text-right">{i.paid ? eur(i.paid) : "–"}</TableCell>
                    <TableCell className={`text-right font-medium ${i.expected > i.planned ? "text-destructive" : ""}`}>{eur(i.expected)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button variant="ghost" size="icon" aria-label={tr("Bearbeiten")} onClick={() => setCostDlg({ id: i.id, initial: { title: c.title, trade_id: c.trade_id, planned: c.planned, description: c.description } })}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={tr("Löschen")} onClick={() => confirm(`„${i.title}“ löschen?`) && remove.mutate({ table: "cost_items", id: i.id })}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {s.items.length > 0 && (
              <TableFooter className="tabular">
                <TableRow><TableCell colSpan={2}>{tr("Summe Positionen")}</TableCell><TableCell className="text-right">{eur(s.items.reduce((a, i) => a + i.planned, 0))}</TableCell><TableCell className="text-right">{eur(s.items.reduce((a, i) => a + i.committed, 0))}</TableCell><TableCell className="text-right">{eur(s.items.reduce((a, i) => a + i.invoiced, 0))}</TableCell><TableCell className="text-right">{eur(s.items.reduce((a, i) => a + i.paid, 0))}</TableCell><TableCell className="text-right">{eur(s.items.reduce((a, i) => a + i.expected, 0))}</TableCell><TableCell /></TableRow>
              </TableFooter>
            )}
          </Table>
          {!s.items.length && <Empty>{tr("Noch keine Kostenpositionen.")}</Empty>}
        </div>
      </Panel>

      <EntityDialog
        open={!!tradeDlg}
        onOpenChange={(o) => !o && setTradeDlg(null)}
        title={tradeDlg?.id ? tr("Gewerk bearbeiten") : tr("Neues Gewerk")}
        scan={tradeDlg?.id ? undefined : "trade"}
        fields={[{ name: "name", label: tr("Name"), required: true, full: true }, { name: "budget", label: tr("Budget (€)"), type: "number", required: true }]}
        initial={tradeDlg?.initial}
        onSubmit={(v) => (tradeDlg?.id ? update.mutateAsync({ table: "trades", id: tradeDlg.id, patch: v }) : create.mutateAsync({ table: "trades", row: v }))}
      />
      <QuickCost open={!!costDlg} onOpenChange={(o) => !o && setCostDlg(null)} initial={costDlg?.initial} editId={costDlg?.id} />
      {project && (
        <EntityDialog
          open={budgetDlg}
          onOpenChange={setBudgetDlg}
          title={tr("Projekt & Gesamtbudget")}
          fields={[
            { name: "name", label: tr("Projektname"), required: true, full: true },
            { name: "address", label: tr("Adresse"), full: true },
            { name: "total_budget", label: tr("Gesamtbudget (€)"), type: "number", required: true },
            { name: "start_date", label: tr("Start"), type: "date" },
            { name: "end_date", label: tr("Geplantes Ende"), type: "date" },
          ]}
          initial={{ ...project }}
          onSubmit={(v) => update.mutateAsync({ table: "projects", id: project.id, patch: v })}
        />
      )}
    </>
  );
}
