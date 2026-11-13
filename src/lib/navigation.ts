import { z } from "zod";

const PRE_CREDIT_NAV_PATHS = [
  "/",
  "/budget",
  "/angebote",
  "/ausgaben",
  "/dokumente",
  "/aufgaben",
  "/kalender",
  "/sammlungen",
  "/kontakte",
] as const;
const PRE_ANALYSIS_NAV_PATHS = [...PRE_CREDIT_NAV_PATHS, "/kredit"] as const;
export const NAV_PATHS = [...PRE_ANALYSIS_NAV_PATHS, "/analyse"] as const;
export const navigationSchema = z
  .object({
    order: z.array(z.enum(NAV_PATHS)).length(NAV_PATHS.length),
    hidden: z.array(z.enum(NAV_PATHS)),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.order).size !== NAV_PATHS.length ||
      new Set(value.hidden).size !== value.hidden.length
    ) {
      context.addIssue({ code: "custom", message: "Navigation entries must be unique" });
    }
  });
export type NavigationPreferences = z.infer<typeof navigationSchema>;
export const DEFAULT_NAVIGATION: NavigationPreferences = {
  order: [...NAV_PATHS],
  hidden: [],
};

/** Navigation schemas from before a page was introduced; the missing pages are appended. */
const LEGACY_NAVIGATION = [PRE_ANALYSIS_NAV_PATHS, PRE_CREDIT_NAV_PATHS] as const;

/** Adds newly introduced pages to existing, otherwise valid navigation preferences. */
export function parseNavigation(value: unknown): NavigationPreferences {
  const current = navigationSchema.safeParse(value);
  if (current.success) return current.data;
  for (const known of LEGACY_NAVIGATION) {
    const legacy = z
      .object({
        order: z.array(z.enum(known)).length(known.length),
        hidden: z.array(z.enum(known)),
      })
      .strict()
      .safeParse(value);
    if (!legacy.success) continue;
    if (
      new Set(legacy.data.order).size !== known.length ||
      new Set(legacy.data.hidden).size !== legacy.data.hidden.length
    ) {
      throw new Error("Navigation entries must be unique");
    }
    return navigationSchema.parse({
      order: [
        ...legacy.data.order,
        ...NAV_PATHS.filter((path) => !(known as readonly string[]).includes(path)),
      ],
      hidden: legacy.data.hidden,
    });
  }
  return navigationSchema.parse(value);
}

export function visibleNavigation(value: NavigationPreferences) {
  return value.order.filter((path) => !value.hidden.includes(path));
}

/** Index of the item matching the current path, or -1 (e.g. settings). */
export function activeNavIndex(items: readonly { to: string }[], pathname: string) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return items.findIndex((item) =>
    item.to === "/" ? path === "/" : path === item.to || path.startsWith(`${item.to}/`),
  );
}
