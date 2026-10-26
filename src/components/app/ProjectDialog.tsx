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
      title={tr("project_dialog.project_total_budget")}
      fields={[
        { name: "name", label: tr("shared.project_name"), required: true, full: true },
        { name: "address", label: tr("shared.address"), full: true },
        { name: "total_budget", label: tr("shared.total_budget_2"), type: "number", required: true },
        { name: "start_date", label: tr("project_dialog.start"), type: "date" },
        { name: "end_date", label: tr("project_dialog.planned_end"), type: "date" },
      ]}
      initial={project}
      onSubmit={(patch) => update.mutateAsync({ table: "projects", id: project.id, patch })}
    />
  );
}
