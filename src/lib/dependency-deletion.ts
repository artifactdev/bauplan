import i18n from "@/i18n";
import type { Workspace } from "./schema";
import { incomingDependencies, type TaskDependency } from "./task-dependencies";

export function dependencyDeletion(
  ws: Pick<Workspace, "tasks">,
  source: Pick<TaskDependency, "source" | "id">,
  fallback: string,
) {
  const consent = incomingDependencies(ws.tasks, source);
  return {
    confirmation: consent.length
      ? i18n.t("deleteLinks", {
          ns: "construction",
          names: consent
            .map((link) => ws.tasks.find((task) => task.id === link.id)?.title)
            .join(", "),
        })
      : fallback,
    ...(consent.length ? { dependencyConsent: consent } : {}),
  };
}
