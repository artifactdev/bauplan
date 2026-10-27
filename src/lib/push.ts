import { z } from "zod";
import type { Workspace } from "./schema";

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        (url.hostname === "fcm.googleapis.com" ||
          url.hostname === "web.push.apple.com" ||
          url.hostname === "updates.push.services.mozilla.com" ||
          url.hostname.endsWith(".push.services.mozilla.com") ||
          url.hostname.endsWith(".notify.windows.com"))
      );
    }, "push.invalid_endpoint"),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=$|^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }),
});
export type PushSubscriptionData = z.infer<typeof pushSubscriptionSchema>;
export type PushJob = {
  id: string;
  kind: "assignment" | "task" | "offer" | "payment" | "event";
  table: "tasks" | "offers" | "expenses" | "events";
  resourceId: string;
  recipient: string | null;
  version: string;
  dueAt: string;
  expiresAt: string;
};

const berlin = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function berlinTime(date: string, time = "09:00"): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const desired = Date.parse(`${date}T${time}:00Z`);
  if (
    !Number.isFinite(desired) ||
    new Date(desired).toISOString().slice(0, 16) !== `${date}T${time}`
  )
    return null;
  let timestamp = desired;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      berlin.formatToParts(timestamp).map((part) => [part.type, part.value]),
    );
    const represented = Date.parse(
      `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}Z`,
    );
    if (represented === desired) return new Date(timestamp);
    timestamp += desired - represented;
  }
  return null;
}

/** Recomputed from current data before enqueueing and again before every delivery. */
export function reminderJobs(workspace: Workspace, now: Date): PushJob[] {
  const jobs: PushJob[] = [];
  const add = (
    kind: PushJob["kind"],
    table: PushJob["table"],
    resourceId: string,
    recipient: string | null,
    version: string,
    due: Date,
    expires: Date,
  ) => {
    if (now < due || now >= expires) return;
    jobs.push({
      id: `${kind}:${resourceId}:${version}:${due.toISOString()}`,
      kind,
      table,
      resourceId,
      recipient,
      version,
      dueAt: due.toISOString(),
      expiresAt: expires.toISOString(),
    });
  };
  const deadline = (
    kind: PushJob["kind"],
    table: PushJob["table"],
    id: string,
    date: string | null | undefined,
    recipient: string | null,
  ) => {
    if (!date || !berlinTime(date)) return;
    for (const days of [3, 0]) {
      const shifted = new Date(`${date}T12:00:00Z`);
      if (!Number.isFinite(shifted.getTime())) continue;
      shifted.setUTCDate(shifted.getUTCDate() - days);
      const day = shifted.toISOString().slice(0, 10);
      const due = berlinTime(day);
      const next = new Date(shifted);
      next.setUTCDate(next.getUTCDate() + 1);
      const expires = berlinTime(next.toISOString().slice(0, 10), "00:00");
      if (due && expires)
        add(kind, table, id, recipient, `${date}:${recipient ?? "all"}`, due, expires);
    }
  };
  for (const task of workspace.tasks)
    if (["offen", "in_arbeit"].includes(task.status) && task.assignee_id)
      deadline("task", "tasks", task.id, task.due_date, task.assignee_id);
  for (const offer of workspace.offers)
    if (["requested", "received"].includes(offer.status))
      deadline("offer", "offers", offer.id, offer.valid_until, null);
  for (const expense of workspace.expenses)
    if (expense.status === "offen" && !expense.payment_date)
      deadline("payment", "expenses", expense.id, expense.due_date, null);
  for (const event of workspace.events) {
    if (!event.start_time) continue;
    const start = berlinTime(event.event_date, event.start_time);
    if (start)
      add(
        "event",
        "events",
        event.id,
        null,
        `${event.event_date}:${event.start_time}`,
        new Date(start.getTime() - 3_600_000),
        start,
      );
  }
  return jobs;
}

export function validPushJob(job: PushJob, workspace: Workspace, now: Date): boolean {
  if (now >= new Date(job.expiresAt)) return false;
  if (job.kind !== "assignment")
    return reminderJobs(workspace, now).some((candidate) => candidate.id === job.id);
  const task = workspace.tasks.find((item) => item.id === job.resourceId);
  return !!task && task.assignee_id === job.recipient && task.status !== "erledigt";
}

export function pushLink(job: PushJob): string {
  const route = { tasks: "aufgaben", offers: "angebote", expenses: "ausgaben", events: "kalender" }[
    job.table
  ];
  return `/${route}?eintrag=${encodeURIComponent(job.resourceId)}`;
}
