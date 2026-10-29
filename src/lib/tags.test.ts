import { describe, expect, it } from "vitest";
import { collectTags, joinTags, splitTags, toggleTag } from "./tags";

describe("tags", () => {
  it("splits, trims and de-duplicates case-insensitively", () => {
    expect(splitTags(" Bad, küche ,,bad,Küche ")).toEqual(["Bad", "küche"]);
    expect(splitTags(null)).toEqual([]);
    expect(joinTags(["a", " b ", "A"])).toBe("a, b");
  });

  it("toggles tags", () => {
    expect(toggleTag("Bad, Küche", "küche")).toBe("Bad");
    expect(toggleTag("Bad", "Flur")).toBe("Bad, Flur");
    expect(toggleTag("", "a,b")).toBe("a b");
    expect(toggleTag("Bad", "  ")).toBe("Bad");
  });

  it("collects distinct sorted tags", () => {
    expect(collectTags(["Holz, Bad", null, "bad, Altbau"])).toEqual(["Altbau", "Bad", "Holz"]);
  });
});
