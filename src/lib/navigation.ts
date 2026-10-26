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
export const NAV_PATHS = [...PRE_CREDIT_NAV_PATHS, "/kredit"] as const;
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

const legacyNavigationSchema = z
  .object({
    order: z.array(z.enum(PRE_CREDIT_NAV_PATHS)).length(PRE_CREDIT_NAV_PATHS.length),
    hidden: z.array(z.enum(PRE_CREDIT_NAV_PATHS)),
  })
  .strict();

/** Adds newly introduced pages to existing, otherwise valid navigation preferences. */
export function parseNavigation(value: unknown): NavigationPreferences {
  const current = navigationSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = legacyNavigationSchema.parse(value);
  if (
    new Set(legacy.order).size !== PRE_CREDIT_NAV_PATHS.length ||
    new Set(legacy.hidden).size !== legacy.hidden.length
  ) {
    throw new Error("Navigation entries must be unique");
  }
  return navigationSchema.parse({
    order: [...legacy.order, "/kredit"],
    hidden: legacy.hidden,
  });
}

export function visibleNavigation(value: NavigationPreferences) {
  return value.order.filter((path) => !value.hidden.includes(path));
}
