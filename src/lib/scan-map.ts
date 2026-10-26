import type { Extraction } from "./ocr-parse";

export type ScanTarget = "offer" | "invoice" | "expense" | "task" | "event" | "cost" | "trade";

/** Tables whose rows can link the scanned document directly. */
export const LINKS_DOCUMENT: Record<ScanTarget, boolean> = {
  offer: true, invoice: true, expense: true, task: true, event: false, cost: false, trade: false,
};

/**
 * Turns a recognized document into form values for the given form.
 * Only fields with a value are returned so existing input is never wiped.
 */
export function mapExtraction(
  target: ScanTarget,
  ex: Extraction | null,
  fileName: string,
  trades: { id: string; name: string }[],
): Record<string, unknown> {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const tradeId = ex?.trade ? trades.find((t) => t.name.toLowerCase() === ex.trade!.toLowerCase())?.id ?? null : null;
  const title = ex?.title ?? ex?.vendor ?? base;
  const raw: Record<string, unknown> = (() => {
    switch (target) {
      case "offer":
        return { contractor: ex?.vendor, title, amount: ex?.amount, offer_date: ex?.date, trade_id: tradeId, notes: ex?.summary };
      case "invoice":
        return { contractor: ex?.vendor, title, amount: ex?.amount, invoice_date: ex?.date, due_date: ex?.due_date, trade_id: tradeId };
      case "expense":
        return { title, vendor: ex?.vendor, amount: ex?.amount, expense_date: ex?.date, category: ex?.expense_category, trade_id: tradeId, notes: ex?.summary };
      case "task":
        return { title, due_date: ex?.due_date, trade_id: tradeId, notes: ex?.summary };
      case "event":
        return { title, event_date: ex?.due_date ?? ex?.date, trade_id: tradeId, notes: ex?.summary };
      case "cost":
        return { title, planned: ex?.amount, trade_id: tradeId, description: ex?.summary };
      case "trade":
        return { name: ex?.trade ?? ex?.vendor ?? base, budget: ex?.amount };
    }
  })();
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}
