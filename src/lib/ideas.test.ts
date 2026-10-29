import { describe, expect, it } from "vitest";
import { ideaImages } from "./ideas";
import type { Doc, IdeaImage } from "./schema";

const image = (id: string, extra: Partial<IdeaImage> = {}) =>
  ({
    id,
    idea_id: "i",
    name: id,
    created_at: "2026-01-01",
    storage_path: `p/${id}`,
    ...extra,
  }) as IdeaImage;
const doc = (id: string, extra: Partial<Doc> = {}) =>
  ({ id, name: id, created_at: "2026-01-01", storage_path: `p/${id}`, ...extra }) as Doc;

describe("ideaImages", () => {
  it("puts the legacy document first, then own images by creation time", () => {
    const images = [
      image("b", { created_at: "2026-01-03" }),
      image("a", { created_at: "2026-01-02" }),
      image("other", { idea_id: "x" }),
    ];
    const refs = ideaImages({ id: "i", document_id: "legacy" }, images, [doc("legacy")]);
    expect(refs.map((r) => [r.id, r.source])).toEqual([
      ["legacy", "document"],
      ["a", "image"],
      ["b", "image"],
    ]);
  });
  it("skips missing legacy documents and entries without a file", () => {
    const images = [image("a"), image("c", { storage_path: null })];
    expect(ideaImages({ id: "i", document_id: "gone" }, images, []).map((r) => r.id)).toEqual([
      "a",
    ]);
  });
});
