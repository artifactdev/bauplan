import { describe, expect, it } from "vitest";
import { analysisFiltersSchema } from "./analysis";
import { analysisPresets } from "./analysis-presets";

const pots = [
  { id: "bank", name: "Bank", deducts_from_budget: false, notes: null },
  { id: "jerry", name: "Jerry", deducts_from_budget: false, notes: null },
];

describe("analysis presets", () => {
  const ids = (presets: ReturnType<typeof analysisPresets>) => presets.map((preset) => preset.id);

  it("only offers presets the project has data for", () => {
    expect(
      ids(analysisPresets({ budget_pots: [pots[0]!], credit_terms: [] }, "2026-11-13")),
    ).not.toEqual(expect.arrayContaining(["private_advance", "loan_costs"]));
    const full = analysisPresets({ budget_pots: pots, credit_terms: [{} as never] }, "2026-11-13");
    expect(ids(full)).toEqual(expect.arrayContaining(["private_advance", "loan_costs"]));
    expect(full.find((preset) => preset.id === "private_advance")?.filters.potIds).toEqual([
      "jerry",
    ]);
  });

  it("resolves relative periods against today and produces valid unique filters", () => {
    const presets = analysisPresets({ budget_pots: pots, credit_terms: [] }, "2026-11-13");
    expect(new Set(ids(presets)).size).toBe(presets.length);
    const last90 = presets.find((preset) => preset.id === "last_90_days")!;
    expect(last90.filters).toMatchObject({ from: "2026-08-15", to: "2026-11-13" });
    expect(presets.find((preset) => preset.id === "quarterly_report")?.filters).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
      granularity: "quarter",
    });
    for (const preset of presets)
      expect(analysisFiltersSchema.safeParse(preset.filters).success).toBe(true);
  });
});
