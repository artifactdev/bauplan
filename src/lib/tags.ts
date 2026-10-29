// Tags are stored as a comma-separated string.

export function splitTags(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of (value ?? "").split(",")) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLocaleLowerCase())) continue;
    seen.add(tag.toLocaleLowerCase());
    tags.push(tag);
  }
  return tags;
}

export function joinTags(tags: readonly string[]): string {
  return splitTags(tags.join(",")).join(", ");
}

/** Adds the tag (or removes it when already present, case-insensitive). */
export function toggleTag(value: string | null | undefined, tag: string): string {
  const tags = splitTags(value);
  const key = tag.trim().toLocaleLowerCase();
  if (!key) return joinTags(tags);
  return tags.some((t) => t.toLocaleLowerCase() === key)
    ? joinTags(tags.filter((t) => t.toLocaleLowerCase() !== key))
    : joinTags([...tags, tag.replace(/,/g, " ").trim()]);
}

/** All distinct tags of the given values, sorted for display. */
export function collectTags(
  values: readonly (string | null | undefined)[],
  locale = "de",
): string[] {
  return splitTags(values.join(",")).sort((a, b) => a.localeCompare(b, locale));
}
