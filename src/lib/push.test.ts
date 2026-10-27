import { describe, expect, it } from "vitest";
import { berlinTime, pushLink, pushSubscriptionSchema, reminderJobs, validPushJob } from "./push";
import type { Workspace } from "./schema";

const empty = (): Workspace => ({
  projects: [],
  trades: [],
  cost_items: [],
  offers: [],
  invoices: [],
  documents: [],
  tasks: [],
  events: [],
  expenses: [],
  ideas: [],
  contacts: [],
  budget_pots: [],
  funding_entries: [],
  credit_terms: [],
  credit_repayments: [],
});

function workspace() {
  const ws = empty();
  ws.tasks.push({
    id: "task",
    title: "Task",
    status: "offen",
    assignee_id: "member",
    due_date: "2026-10-30",
    trade_id: null,
    phase: null,
    priority: "mittel",
    notes: null,
    cost_item_id: null,
    document_id: null,
  });
  ws.offers.push({
    id: "offer",
    contractor: "Private",
    title: null,
    amount: 100,
    status: "received",
    valid_until: "2026-10-30",
    trade_id: null,
    cost_item_id: null,
    document_id: null,
    contact_id: null,
    requested_date: null,
    offer_date: null,
    notes: null,
  });
  ws.expenses.push({
    id: "expense",
    title: "Private",
    amount: 50,
    status: "offen",
    due_date: "2026-10-30",
    vendor: null,
    expense_date: null,
    category: null,
    trade_id: null,
    cost_item_id: null,
    document_id: null,
    notes: null,
  });
  ws.events.push({
    id: "event",
    title: "Private",
    event_date: "2026-10-27",
    start_time: "10:00",
    end_date: null,
    end_time: null,
    kind: "termin",
    trade_id: null,
    notes: null,
  });
  return ws;
}

describe("push reminder rules", () => {
  it("uses Berlin time across summer, winter and DST transitions", () => {
    expect(berlinTime("2026-07-01")?.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(berlinTime("2026-12-01")?.toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(berlinTime("2026-03-29")?.toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(berlinTime("2026-10-25")?.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(berlinTime("2026-03-29", "02:30")).toBeNull();
    expect(berlinTime("broken")).toBeNull();
    expect(berlinTime("2026-02-30")).toBeNull();
  });
  it("schedules three-day and same-day reminders, with no daily overdue repeat", () => {
    const ws = workspace();
    expect(reminderJobs(ws, new Date("2026-10-27T07:59:59Z"))).toHaveLength(0);
    const jobs = reminderJobs(ws, new Date("2026-10-27T08:00:00Z"));
    expect(jobs.map((job) => job.kind)).toEqual(["task", "offer", "payment", "event"]);
    expect(jobs[0]?.recipient).toBe("member");
    expect(jobs[1]?.recipient).toBeNull();
    expect(pushLink(jobs[0]!)).toBe("/aufgaben?eintrag=task");
    expect(reminderJobs(ws, new Date("2026-10-28T08:00:00Z"))).toHaveLength(0);
    expect(reminderJobs(ws, new Date("2026-10-30T08:00:00Z"))).toHaveLength(3);
    expect(reminderJobs(ws, new Date("2026-10-31T08:00:00Z"))).toHaveLength(0);
  });
  it("skips completed, unassigned, accepted/rejected and paid records", () => {
    const ws = workspace();
    ws.tasks[0]!.status = "erledigt";
    ws.offers[0]!.status = "rejected";
    ws.expenses[0]!.status = "bezahlt";
    ws.events[0]!.start_time = null;
    expect(reminderJobs(ws, new Date("2026-10-27T08:00:00Z"))).toHaveLength(0);
    ws.tasks[0]!.status = "offen";
    ws.tasks[0]!.assignee_id = null;
    ws.offers[0]!.status = "accepted";
    ws.expenses[0]!.status = "eingereicht";
    expect(reminderJobs(ws, new Date("2026-10-27T08:00:00Z"))).toHaveLength(0);
  });
  it("invalidates queued reminders after payment, reassignment, date change or deletion", () => {
    const ws = workspace();
    const now = new Date("2026-10-27T08:00:00Z");
    const jobs = reminderJobs(ws, now);
    expect(jobs.every((job) => validPushJob(job, ws, now))).toBe(true);
    ws.tasks[0]!.assignee_id = "other";
    ws.offers[0]!.valid_until = "2026-11-20";
    ws.expenses[0]!.payment_date = "2026-10-27";
    ws.events = [];
    expect(jobs.every((job) => !validPushJob(job, ws, now))).toBe(true);
  });
  it("expires calendar reminders at start and date reminders at Berlin midnight", () => {
    expect(
      reminderJobs(workspace(), new Date("2026-10-27T09:00:00Z")).map((job) => job.kind),
    ).not.toContain("event");
    expect(reminderJobs(workspace(), new Date("2026-10-27T23:00:00Z"))).toHaveLength(0);
  });
  it("rejects arbitrary or private push destinations and malformed keys", () => {
    const valid = {
      endpoint: "https://web.push.apple.com/test",
      keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
    };
    expect(pushSubscriptionSchema.safeParse(valid).success).toBe(true);
    for (const endpoint of [
      "http://localhost/test",
      "https://127.0.0.1/x",
      "https://web.push.apple.com.evil.test/x",
      "https://user:pass@web.push.apple.com/x",
      "https://web.push.apple.com:8443/x",
    ])
      expect(pushSubscriptionSchema.safeParse({ ...valid, endpoint }).success).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({ ...valid, keys: { auth: "x", p256dh: "x" } }).success,
    ).toBe(false);
  });
});
