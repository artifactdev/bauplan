import { describe, expect, it } from "vitest";
import { DEFAULT_NAVIGATION, NAV_PATHS, navigationSchema, visibleNavigation } from "./navigation";

describe("Navigation preferences", () => {
  it("keeps ordered visible pages, including an empty navigation", () => {
    const order = [...NAV_PATHS].reverse();
    expect(visibleNavigation({ order, hidden: ["/budget"] })).toEqual(
      order.filter((path) => path !== "/budget"),
    );
    expect(visibleNavigation({ order, hidden: [...NAV_PATHS] })).toEqual([]);
    expect(navigationSchema.parse(DEFAULT_NAVIGATION)).toEqual(DEFAULT_NAVIGATION);
  });
  it("rejects missing, duplicate, unknown, and privileged input", () => {
    for (const value of [
      { order: ["/"], hidden: [] },
      { order: NAV_PATHS.map(() => "/"), hidden: [] },
      { order: [...NAV_PATHS], hidden: ["/budget", "/budget"] },
      { order: [...NAV_PATHS], hidden: ["/einstellungen"] },
      { ...DEFAULT_NAVIGATION, userId: "other" },
    ])
      expect(navigationSchema.safeParse(value).success).toBe(false);
  });
});
