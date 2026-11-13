import { useState } from "react";
import { BookmarkPlus, Pencil, RefreshCw, Star, Trash2 } from "lucide-react";
import { tr } from "@/i18n";
import type { AnalysisFilters, AnalysisViews, Section } from "@/lib/analysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_VIEW = "__none";

function NamePopover({
  trigger,
  title,
  initial,
  disabled,
  onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  initial: string;
  disabled?: boolean;
  onSubmit: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(initial);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onSubmit(name.trim());
            setOpen(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="analysis-view-name">{title}</Label>
            <Input
              id="analysis-view-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <Button type="submit" size="sm" disabled={!name.trim() || disabled}>
            {tr("shared.save")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Pick, save, update, rename, delete and default-mark saved filter views. */
export function AnalysisViewsBar({
  views,
  activeId,
  filters,
  section,
  canAdd,
  saving,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onDefault,
}: {
  views: AnalysisViews;
  activeId: string | null;
  filters: AnalysisFilters;
  section: Section;
  canAdd: boolean;
  saving: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (name: string) => void;
  onUpdate: (
    id: string,
    patch: { name?: string; section?: Section; filters?: AnalysisFilters },
  ) => void;
  onRemove: (id: string) => void;
  onDefault: (id: string | null) => void;
}) {
  const active = views.views.find((view) => view.id === activeId);
  const modified =
    !!active &&
    (active.section !== section || JSON.stringify(active.filters) !== JSON.stringify(filters));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={active?.id ?? NO_VIEW}
        onValueChange={(value) => onSelect(value === NO_VIEW ? null : value)}
      >
        <SelectTrigger className="w-full sm:w-64" aria-label={tr("analysis.views")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_VIEW}>{tr("analysis.no_view")}</SelectItem>
          {views.views.map((view) => (
            <SelectItem key={view.id} value={view.id}>
              {view.id === views.defaultId ? "★ " : ""}
              {view.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active && modified && (
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => onUpdate(active.id, { section, filters })}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> {tr("analysis.update_view")}
        </Button>
      )}
      {active && (
        <>
          <Button
            size="icon"
            variant="ghost"
            disabled={saving}
            aria-pressed={views.defaultId === active.id}
            aria-label={tr("analysis.default_view")}
            title={tr("analysis.default_view")}
            onClick={() => onDefault(views.defaultId === active.id ? null : active.id)}
          >
            <Star
              className={
                views.defaultId === active.id ? "h-4 w-4 fill-warning text-warning" : "h-4 w-4"
              }
            />
          </Button>
          <NamePopover
            title={tr("analysis.view_name")}
            initial={active.name}
            disabled={saving}
            onSubmit={(name) => onUpdate(active.id, { name })}
            trigger={
              <Button
                size="icon"
                variant="ghost"
                aria-label={tr("analysis.rename_view")}
                title={tr("analysis.rename_view")}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          <Button
            size="icon"
            variant="ghost"
            disabled={saving}
            aria-label={tr("analysis.delete_view")}
            title={tr("analysis.delete_view")}
            onClick={() =>
              confirm(tr("analysis.delete_view_confirm", { name: active.name })) &&
              onRemove(active.id)
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      )}
      <NamePopover
        title={tr("analysis.view_name")}
        initial=""
        disabled={saving || !canAdd}
        onSubmit={onAdd}
        trigger={
          <Button
            size="sm"
            variant="outline"
            disabled={!canAdd}
            title={canAdd ? undefined : tr("analysis.views_limit")}
          >
            <BookmarkPlus className="h-4 w-4" aria-hidden="true" /> {tr("analysis.save_view")}
          </Button>
        }
      />
    </div>
  );
}
