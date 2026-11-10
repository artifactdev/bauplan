import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { tr } from "@/i18n";
import { parseTaskChecklist } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function TaskChecklist({
  value,
  onChange,
  disabled = false,
  editable = true,
  addable = editable,
  autoFocus = false,
  compact = false,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  editable?: boolean;
  addable?: boolean;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const items = parseTaskChecklist(value);
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onChange(JSON.stringify([...items, { id: crypto.randomUUID(), title, done: false }]));
    setDraft("");
  };
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
      <legend className={compact ? "sr-only" : "mb-2 text-sm font-medium"}>
        {tr("task-checklist.title")}
      </legend>
      {!compact && items.length > 0 && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {tr("task-checklist.progress", {
            done: items.filter((item) => item.done).length,
            total: items.length,
          })}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center gap-2">
            <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
              <Checkbox
                checked={item.done}
                onCheckedChange={(checked) =>
                  onChange(
                    JSON.stringify(
                      items.map((row) =>
                        row.id === item.id ? { ...row, done: checked === true } : row,
                      ),
                    ),
                  )
                }
              />
              <span
                className={cn(
                  "min-w-0 [overflow-wrap:anywhere]",
                  item.done && "text-muted-foreground line-through",
                )}
              >
                {item.title}
              </span>
            </label>
            {editable && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-11 shrink-0"
                aria-label={tr("task-checklist.remove", { title: item.title })}
                onClick={() => onChange(JSON.stringify(items.filter((row) => row.id !== item.id)))}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {addable && (
        <div className="flex w-full max-w-xl items-center gap-2">
          <Input
            className="h-11 min-w-0 flex-1"
            autoFocus={autoFocus}
            aria-label={tr("task-checklist.new")}
            placeholder={tr("task-checklist.new")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            title={tr("task-checklist.add")}
            aria-label={tr("task-checklist.add")}
            disabled={!draft.trim()}
            onClick={add}
          >
            <Plus />
          </Button>
        </div>
      )}
    </fieldset>
  );
}
