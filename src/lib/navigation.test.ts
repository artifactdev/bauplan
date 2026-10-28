import { describe, expect, it } from "vitest";
import {
  activeNavIndex,
  nextBarVisibility,
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
    const previous = NAV_PATHS.filter((path) => path !== "/kredit");
    const parsed = parseNavigation({ order: [...previous].reverse(), hidden: ["/budget"] });
    expect(parsed.order).toHaveLength(NAV_PATHS.length);
    expect(parsed.order.slice(0, -1)).toEqual([...previous].reverse());
    expect(parsed.order.at(-1)).toBe("/kredit");
    expect(parsed.hidden).toEqual(["/budget"]);
  });
  it("finds the active item, including nested routes", () => {
    const items = [{ to: "/" }, { to: "/budget" }, { to: "/kalender" }];
    expect(activeNavIndex(items, "/")).toBe(0);
    expect(activeNavIndex(items, "/budget/")).toBe(1);
    expect(activeNavIndex(items, "/kalender/termin")).toBe(2);
    expect(activeNavIndex(items, "/einstellungen")).toBe(-1);
  });
  it("hides the bar on scroll down and shows it on scroll up or near the top", () => {
    expect(nextBarVisibility(true, 100, 200)).toBe(false);
    expect(nextBarVisibility(false, 200, 150)).toBe(true);
    expect(nextBarVisibility(false, 200, 199)).toBe(true);
    expect(nextBarVisibility(false, 200, 40)).toBe(true);
    expect(nextBarVisibility(false, 200, 203)).toBe(false);
    expect(nextBarVisibility(true, 200, 203)).toBe(true);
  });
});
