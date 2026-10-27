import type { Task } from "./schema";

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
