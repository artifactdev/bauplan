import type { Task } from "./schema";
import { z } from "zod";

const checklistSchema = z
  .array(z.object({ id: z.string().min(1), title: z.string().trim().min(1), done: z.boolean() }))
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length);

export type TaskChecklistItem = z.infer<typeof checklistSchema>[number];

export function parseTaskChecklist(value: unknown): TaskChecklistItem[] {
  if (value === null || value === undefined || value === "") return [];
  try {
    if (typeof value !== "string") throw new Error("Invalid checklist");
    return checklistSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("task-checklist.invalid");
  }
}

export function taskRange(task: Pick<Task, "start_date" | "due_date">) {
  const start = task.start_date || task.due_date;
  if (!start) return null;
  return { event_date: start, end_date: task.due_date || start };
}

export function validateTaskDates(row: Record<string, unknown>) {
  for (const column of ["start_date", "due_date"]) {
    const value = row[column];
    if (value === undefined || value === null || value === "") continue;
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
    )
      throw new Error("tasks.invalid_date");
  }

  const start = row["start_date"];
  const end = row["due_date"];
  if (typeof start === "string" && start && typeof end === "string" && end && end < start)
    throw new Error("tasks.due_before_start");
}

export function taskCompletionPatch(
  patch: Record<string, unknown>,
  previous?: Record<string, unknown> | null,
  now = new Date(),
  preserveUnknown = false,
): Record<string, unknown> {
  if (!("status" in patch) && !("completed_at" in patch) && !("completed_on" in patch))
    return patch;
  const status = patch["status"] ?? previous?.["status"];
  if (status !== "erledigt") return { ...patch, completed_at: null, completed_on: null };
  if (previous?.["status"] === "erledigt")
    return {
      ...patch,
      completed_at: previous["completed_at"] ?? null,
      completed_on: previous["completed_on"] ?? null,
    };
  if (preserveUnknown && patch["completed_at"] === null && patch["completed_on"] === null)
    return patch;
  const local = new Date(now);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  const completed_at = patch["completed_at"] ?? now.toISOString();
  const completed_on = patch["completed_on"] ?? local.toISOString().slice(0, 10);
  if (
    typeof completed_at !== "string" ||
    !z.string().datetime({ offset: true }).safeParse(completed_at).success ||
    typeof completed_on !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(completed_on) ||
    !Number.isFinite(Date.parse(`${completed_on}T00:00:00Z`)) ||
    new Date(`${completed_on}T00:00:00Z`).toISOString().slice(0, 10) !== completed_on
  )
    throw new Error("tasks.invalid_completion_date");
  return { ...patch, completed_at, completed_on };
}
