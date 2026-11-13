import { describe, expect, it } from "vitest";
import {
  activeNavIndex,
  DEFAULT_NAVIGATION,
  NAV_PATHS,
  navigationSchema,
  parseNavigation,
  visibleNavigation,
} from "./navigation";

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
  it("adds the credit page to existing saved navigation preferences", () => {
    const previous = NAV_PATHS.filter((path) => path !== "/kredit" && path !== "/analyse");
    const parsed = parseNavigation({ order: [...previous].reverse(), hidden: ["/budget"] });
    expect(parsed.order).toHaveLength(NAV_PATHS.length);
    expect(parsed.order.slice(0, -2)).toEqual([...previous].reverse());
    expect(parsed.order.slice(-2)).toEqual(["/kredit", "/analyse"]);
    expect(parsed.hidden).toEqual(["/budget"]);
  });
  it("adds the analysis page to saved preferences without changing their order", () => {
    const previous = NAV_PATHS.filter((path) => path !== "/analyse");
    const order = [...previous].reverse();
    const parsed = parseNavigation({ order, hidden: ["/kredit"] });
    expect(parsed.order).toEqual([...order, "/analyse"]);
    expect(parsed.hidden).toEqual(["/kredit"]);
  });
  it("still rejects invalid legacy preferences", () => {
    expect(() => parseNavigation({ order: ["/"], hidden: [] })).toThrow();
    expect(() =>
      parseNavigation({ order: [...NAV_PATHS].slice(1), hidden: ["/einstellungen"] }),
    ).toThrow();
  });
  it("finds the active item, including nested routes", () => {
    const items = [{ to: "/" }, { to: "/budget" }, { to: "/kalender" }];
    expect(activeNavIndex(items, "/")).toBe(0);
    expect(activeNavIndex(items, "/budget/")).toBe(1);
    expect(activeNavIndex(items, "/kalender/termin")).toBe(2);
    expect(activeNavIndex(items, "/einstellungen")).toBe(-1);
  });
});
