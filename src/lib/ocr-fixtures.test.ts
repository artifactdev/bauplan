import { describe, expect, it } from "vitest";
import { FIXTURES } from "./ocr-fixtures";
import { extractFromText } from "./ocr-parse";

describe("field extraction on the receipt/invoice corpus", () => {
  it.each(FIXTURES.map((f) => [f.name, f] as const))("%s", (_, f) => {
    const r = extractFromText(f.text, f.alternates ? { alternates: f.alternates } : {});
    expect({
      doc_type: r.doc_type,
      vendor: r.vendor,
      amount: r.amount,
      date: r.date,
      ...("due_date" in f.expected ? { due_date: r.due_date } : {}),
    }).toEqual(f.expected);
  });
});
