import { tr } from "@/i18n";
import { useMutations } from "@/hooks/use-workspace";
import { EntityDialog } from "./EntityDialog";

export function ProjectCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { create } = useMutations();
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tr("project_dialog.new_project")}
      submitLabel={tr("project_dialog.create_project")}
      fields={[
        { name: "name", label: tr("shared.project_name"), required: true, full: true },
        { name: "address", label: tr("shared.address"), full: true },
        {
          name: "total_budget",
          label: tr("shared.total_budget_2"),
          type: "number",
          required: true,
        },
        { name: "start_date", label: tr("project_dialog.start"), type: "date" },
        { name: "end_date", label: tr("project_dialog.planned_end"), type: "date" },
      ]}
      initial={{ name: "", address: "", total_budget: 0 }}
      onSubmit={(row) => create.mutateAsync({ table: "projects", row })}
    />
  );
}
