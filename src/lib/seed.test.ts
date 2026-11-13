import { describe, expect, it } from "vitest";
import { buildDemoSeed } from "./seed";

describe("buildDemoSeed", () => {
  it("provides generic records across the workspace without enabling link screenshots", () => {
    const seed = buildDemoSeed();

    expect(seed.projects[0]).toMatchObject({
      name: "Demo",
      address: null,
      link_previews_enabled: false,
    });
    for (const table of [
      "trades",
      "cost_items",
      "offers",
      "expenses",
      "tasks",
      "events",
      "ideas",
      "contacts",
      "budget_pots",
      "funding_entries",
      "credit_terms",
      "credit_repayments",
    ] as const)
      expect(seed[table].length, table).toBeGreaterThan(0);

    expect(
      JSON.stringify(seed).match(/Freiburg|Huber|Bodenwelt|Wiesner|Schneider|Albrecht/),
    ).toBeNull();
    expect(
      seed.ideas.every((idea) => {
        const url = idea["url"];
        return typeof url === "string" && url.startsWith("https://");
      }),
    ).toBe(true);
  });
});
