import { z } from "zod";

export const NAV_PATHS = [
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

export function visibleNavigation(value: NavigationPreferences) {
  return value.order.filter((path) => !value.hidden.includes(path));
}
