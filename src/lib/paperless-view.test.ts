import { describe, expect, it } from "vitest";
import { matchesPaperlessPresence, visibleSelection } from "./paperless-view";

describe("known Paperless linkage filters", () => {
  it("uses established links, not pending transfer or individual access state", () => {
    expect(matchesPaperlessPresence("present", true)).toBe(true);
    expect(matchesPaperlessPresence("absent", true)).toBe(false);
    expect(matchesPaperlessPresence("present", false)).toBe(false);
    expect(matchesPaperlessPresence("absent", false)).toBe(true);
    expect(matchesPaperlessPresence("all", false)).toBe(true);
    expect(matchesPaperlessPresence("all", true)).toBe(true);
  });

  it("never transfers hidden or unloaded documents", () => {
    expect(visibleSelection(["a", "hidden", "b"], ["b", "c"])).toEqual(["b"]);
  });
});
