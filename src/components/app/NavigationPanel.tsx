import { useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useNavigation } from "@/hooks/use-navigation";
import { saveNavigation } from "@/lib/data.functions";
import { DEFAULT_NAVIGATION, type NavigationPreferences } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Panel } from "./ui-bits";
import { navigationItem } from "./navigation-items";

function SortableNavigationItem({
  path,
  disabled,
  children,
}: {
  path: NavigationPreferences["order"][number];
  disabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation("navigation");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: path, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex min-w-0 items-center gap-2 rounded-lg border bg-card p-2",
        isDragging && "z-10 border-primary shadow-lg",
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 touch-none cursor-grab active:cursor-grabbing"
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label={t("drag", { name: navigationItem(path).label() })}
      >
        <GripVertical />
      </Button>
      {children}
    </li>
  );
}

export function NavigationPanel({ userId }: { userId: string }) {
  const { t } = useTranslation("navigation");
  const query = useNavigation(userId);
  const client = useQueryClient();
  const [draft, setDraft] = useState<NavigationPreferences | null>(null);
  const value = draft ?? query.data;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const save = useMutation({
    mutationFn: (preferences: NavigationPreferences) => saveNavigation({ data: preferences }),
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey: ["navigation", userId] });
      client.setQueryData(["navigation", userId], saved);
      setDraft(null);
      toast.success(t("saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  function move(index: number, direction: number) {
    if (!value) return;
    const order = [...value.order];
    const next = index + direction;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next]!, order[index]!];
    setDraft({ ...value, order });
  }
  return (
    <Panel title={t("title")} className="lg:col-span-2">
      <p className="mb-4 text-sm text-muted-foreground">{t("hint")}</p>
      {query.isError ? (
        <div role="alert">
          <p>{t("loadError")}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !value ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <fieldset disabled={save.isPending} className="min-w-0">
          <legend className="sr-only">{t("title")}</legend>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={{
              screenReaderInstructions: { draggable: t("dragInstructions") },
              announcements: {
                onDragStart: ({ active }) => {
                  const path = value.order.find((entry) => entry === active.id);
                  return path
                    ? t("dragStarted", { name: navigationItem(path).label() })
                    : undefined;
                },
                onDragOver: ({ over }) =>
                  over
                    ? t("dragPosition", {
                        position: value.order.findIndex((path) => path === over.id) + 1,
                        count: value.order.length,
                      })
                    : undefined,
                onDragEnd: ({ over }) =>
                  over
                    ? t("dragDropped", {
                        position: value.order.findIndex((path) => path === over.id) + 1,
                        count: value.order.length,
                      })
                    : t("dragCancelled"),
                onDragCancel: () => t("dragCancelled"),
              },
            }}
            onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id || save.isPending) return;
              const from = value.order.findIndex((path) => path === active.id);
              const to = value.order.findIndex((path) => path === over.id);
              setDraft({ ...value, order: arrayMove(value.order, from, to) });
            }}
          >
            <SortableContext items={value.order} strategy={verticalListSortingStrategy}>
              <ol className="grid gap-2">
                {value.order.map((path, index) => {
                  const item = navigationItem(path);
                  const label = item.label();
                  return (
                    <SortableNavigationItem key={path} path={path} disabled={save.isPending}>
                      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={!value.hidden.includes(path)}
                          onChange={(event) =>
                            setDraft({
                              ...value,
                              hidden: event.target.checked
                                ? value.hidden.filter((entry) => entry !== path)
                                : [...value.hidden, path],
                            })
                          }
                        />
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="[overflow-wrap:anywhere]">{label}</span>
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("up", { name: label })}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("down", { name: label })}
                        disabled={index === value.order.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </SortableNavigationItem>
                  );
                })}
              </ol>
            </SortableContext>
          </DndContext>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => save.mutate(value)} disabled={!draft}>
              {save.isPending ? t("saving") : t("save")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDraft({ order: [...DEFAULT_NAVIGATION.order], hidden: [] })}
            >
              {t("reset")}
            </Button>
          </div>
        </fieldset>
      )}
    </Panel>
  );
}
