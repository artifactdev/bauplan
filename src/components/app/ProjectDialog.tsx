import { tr } from "@/i18n";
import { useMutations } from "@/hooks/use-workspace";
import type { Project } from "@/lib/schema";
import { EntityDialog } from "./EntityDialog";

export function ProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { update } = useMutations();
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tr("Projekt & Gesamtbudget")}
      fields={[
        { name: "name", label: tr("Projektname"), required: true, full: true },
        { name: "address", label: tr("Adresse"), full: true },
        { name: "total_budget", label: tr("Gesamtbudget (€)"), type: "number", required: true },
        { name: "start_date", label: tr("Start"), type: "date" },
        { name: "end_date", label: tr("Geplantes Ende"), type: "date" },
      ]}
      initial={project}
      onSubmit={(patch) => update.mutateAsync({ table: "projects", id: project.id, patch })}
    />
  );
}
