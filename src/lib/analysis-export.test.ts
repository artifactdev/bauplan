import { describe, expect, it } from "vitest";
import { toCsv } from "./analysis-export";

describe("CSV export", () => {
  it("uses semicolons, a BOM and a decimal comma for German", () => {
    expect(
      toCsv(
        [
          ["Name", "Betrag"],
          ["Dach", 1234.5],
        ],
        "de",
      ),
    ).toBe("\uFEFFName;Betrag\r\nDach;1234,5\r\n");
    expect(toCsv([["a", 1.5]], "en")).toBe("\uFEFFa;1.5\r\n");
  });

  it("quotes special characters and neutralizes spreadsheet formulas", () => {
    expect(toCsv([['a;"b"', "x\ny", "=SUM(A1)", "-5", null]], "en")).toBe(
      '\uFEFF"a;""b""";"x\ny";\'=SUM(A1);-5;\r\n',
    );
  });
});
