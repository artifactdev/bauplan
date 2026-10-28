export type PaperlessPresence = "all" | "present" | "absent";

export function matchesPaperlessPresence(presence: PaperlessPresence, linked: boolean): boolean {
  return presence === "all" || (presence === "present" ? linked : !linked);
}

export function visibleSelection(
  selected: readonly string[],
  visible: readonly string[],
): string[] {
  const visibleIds = new Set(visible);
  return selected.filter((id) => visibleIds.has(id));
}
