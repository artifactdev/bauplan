import type { Workspace } from "./schema";
import { tr } from "@/i18n";

export const tradeOptions = (ws: Workspace) =>
  ws.trades.map((t) => ({ value: t.id, label: t.name }));
export const costItemOptions = (ws: Workspace) =>
  ws.cost_items.map((c) => ({ value: c.id, label: c.title }));
export const docOptions = (ws: Workspace) =>
  ws.documents.map((d) => ({ value: d.id, label: d.name }));
export const taskOptions = (ws: Workspace) =>
  ws.tasks.map((d) => ({ value: d.id, label: d.title }));
export const potOptions = (ws: Workspace) =>
  (ws.budget_pots ?? []).map((p) => ({
    value: p.id,
    label: p.deducts_from_budget ? p.name : `${p.name} (${tr("shared.not_budget")})`,
  }));
export const potName = (ws: Workspace, id: string | null | undefined) =>
  id ? (ws.budget_pots?.find((p) => p.id === id)?.name ?? null) : null;
export const tradeName = (ws: Workspace, id: string | null) =>
  ws.trades.find((t) => t.id === id)?.name ?? "–";
export const contactLabel = (c: { name: string; company: string | null }) =>
  c.company ? `${c.company} (${c.name})` : c.name;
export const contactOptions = (ws: Workspace) =>
  ws.contacts.map((c) => ({ value: c.id, label: contactLabel(c) }));
export const offerOptions = (ws: Workspace) =>
  ws.offers.map((offer) => ({
    value: offer.id,
    label: [offer.contractor, offer.title].filter(Boolean).join(" – "),
  }));
