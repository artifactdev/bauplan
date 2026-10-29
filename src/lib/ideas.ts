import type { Doc, Idea, IdeaImage } from "./schema";

export type IdeaImageRef = {
  id: string;
  name: string;
  storage_path: string;
  /** "document" = legacy link via ideas.document_id to a document that is also used elsewhere. */
  source: "image" | "document";
};

/** Images of an idea: a legacy linked document first, then its own images by creation time. */
export function ideaImages(
  idea: Pick<Idea, "id" | "document_id">,
  images: readonly IdeaImage[],
  documents: readonly Doc[],
): IdeaImageRef[] {
  const legacy = idea.document_id ? documents.find((d) => d.id === idea.document_id) : undefined;
  const own = images
    .filter((image) => image.idea_id === idea.id)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const refs: IdeaImageRef[] = [];
  if (legacy?.storage_path)
    refs.push({
      id: legacy.id,
      name: legacy.name,
      storage_path: legacy.storage_path,
      source: "document",
    });
  for (const image of own)
    if (image.storage_path)
      refs.push({
        id: image.id,
        name: image.name,
        storage_path: image.storage_path,
        source: "image",
      });
  return refs;
}
