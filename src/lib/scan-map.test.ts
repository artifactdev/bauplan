import { describe, expect, it } from "vitest";
import { mapExtraction } from "./scan-map";
import type { Extraction } from "./ocr-parse";

const ex: Extraction = {
  doc_type: "kassenzettel", vendor: "Hornbach", contact_id: null, title: null, amount: 50.42, date: "2026-10-20",
  due_date: null, trade: "Elektro", expense_category: "Material", summary: null, tags: [],
};
const trades = [{ id: "t1", name: "Elektro" }];

describe("prefill from scan", () => {
  it("expense gets amount, date, vendor and matching trade", () => {
    expect(mapExtraction("expense", ex, "bon.jpg", trades)).toEqual({
      title: "Hornbach", vendor: "Hornbach", amount: 50.42, expense_date: "2026-10-20", category: "Material", trade_id: "t1",
    });
  });
  it("offers and invoices link a recognized contact", () => {
    const withContact = { ...ex, doc_type: "rechnung" as const, contact_id: "c1" };
    expect(mapExtraction("offer", withContact, "a.pdf", trades)).toMatchObject({ contact_id: "c1", contractor: "Hornbach" });
    expect(mapExtraction("invoice", withContact, "a.pdf", trades)).toMatchObject({ contact_id: "c1" });
    expect(mapExtraction("expense", withContact, "a.pdf", trades)).not.toHaveProperty("contact_id");
  });
  it("without recognized text, the file name becomes the title", () => {
    expect(mapExtraction("task", null, "Fliesen_Angebot.pdf", trades)).toEqual({ title: "Fliesen Angebot" });
  });
});
