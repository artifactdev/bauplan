import { z } from "zod";
import { MAX_DIARY_MEDIA_BYTES } from "./limits";
import { normalizeLegacyExpense } from "./expenses";
import type { DiaryEntry, Task, Workspace } from "./schema";

export const DIARY_MEDIA_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export const DIARY_MEDIA_MAX_BYTES = MAX_DIARY_MEDIA_BYTES;
export const MAX_DIARY_LINKS = 100;
export const DIARY_LINK_TABLES = {
  task_ids: "tasks",
  event_ids: "events",
  trade_ids: "trades",
  offer_ids: "offers",
  payment_ids: "expenses",
} as const;
export type DiarySuggestions = { task_ids: string[]; offer_ids: string[]; payment_ids: string[] };

export const diaryWeatherLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  name: z.string().min(1),
  country: z.string().optional(),
  admin1: z.string().optional(),
});

const diaryIdsSchema = z
  .array(z.string().trim().min(1).max(200))
  .max(MAX_DIARY_LINKS)
  .refine((ids) => new Set(ids).size === ids.length);

export const diaryWeatherSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  code: z.number().int().min(0).max(99),
  temperatureMax: z.number().finite().nullable(),
  temperatureMin: z.number().finite().nullable(),
  precipitation: z.number().finite().min(0).nullable(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  fetchedAt: z.string().datetime(),
  source: z.enum(["forecast", "archive"]),
});

export type DiaryWeather = z.infer<typeof diaryWeatherSchema>;
export type DiaryWeatherLocation = z.infer<typeof diaryWeatherLocationSchema>;

export function parseDiaryIds(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error("diary.invalid_links");
    }
  }
  if (Array.isArray(parsed) && parsed.length > MAX_DIARY_LINKS)
    throw new Error("diary.too_many_links");
  const result = diaryIdsSchema.safeParse(parsed ?? []);
  if (!result.success) throw new Error("diary.invalid_links");
  return result.data;
}

export function serializeDiaryIds(value: unknown): string {
  return JSON.stringify(parseDiaryIds(value));
}

export function parseDiaryWeather(value: unknown): DiaryWeather | null {
  if (value == null || value === "") return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error("diary.invalid_weather");
    }
  }
  const result = diaryWeatherSchema.safeParse(parsed);
  if (!result.success) throw new Error("diary.invalid_weather");
  return result.data;
}

export function serializeDiaryWeather(value: unknown): string | null {
  const parsed = parseDiaryWeather(value);
  return parsed ? JSON.stringify(parsed) : null;
}

export function validateDiaryEntry(row: Record<string, unknown>) {
  const date = row["entry_date"];
  const parsedDate =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? Date.parse(`${date}T00:00:00Z`)
      : Number.NaN;
  if (
    typeof date !== "string" ||
    !Number.isFinite(parsedDate) ||
    new Date(parsedDate).toISOString().slice(0, 10) !== date
  )
    throw new Error("diary.invalid_date");
  if (typeof row["title"] !== "string" || !row["title"].trim() || row["title"].length > 160)
    throw new Error("diary.invalid_title");
  for (const column of ["work_done", "progress", "issues"] as const) {
    const value = row[column];
    if (value != null && (typeof value !== "string" || value.length > 10_000))
      throw new Error("diary.invalid_text");
  }

  for (const column of Object.keys(DIARY_LINK_TABLES)) parseDiaryIds(row[column]);
  const weather = parseDiaryWeather(row["weather_snapshot"]);
  if (weather && weather.date !== date) throw new Error("diary.invalid_weather");
}

export function completedDiaryTasks(tasks: Task[], date: string) {
  return tasks.filter((task) => task.status === "erledigt" && task.completed_on === date);
}

export function diaryDaySuggestions(
  ws: Pick<Workspace, "tasks" | "offers" | "expenses">,
  date: string,
): DiarySuggestions {
  return {
    task_ids: completedDiaryTasks(ws.tasks, date).map((task) => task.id),
    offer_ids: ws.offers.filter((offer) => offer.offer_date === date).map((offer) => offer.id),
    payment_ids: ws.expenses
      .filter(
        (expense) =>
          normalizeLegacyExpense(expense).status === "bezahlt" && expense.payment_date === date,
      )
      .map((expense) => expense.id),
  };
}

export function refreshDiarySuggestions(selected: string[], previous: string[], next: string[]) {
  return [...new Set([...selected.filter((id) => !previous.includes(id)), ...next])];
}

export type DiaryFilters = { search: string; from: string; to: string; tradeId: string };
export const EMPTY_DIARY_FILTERS: DiaryFilters = { search: "", from: "", to: "", tradeId: "" };

export function groupDiaryEntries(entries: DiaryEntry[]) {
  const groups = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const month = entry.entry_date.slice(0, 7);
    const group = groups.get(month);
    if (group) group.push(entry);
    else groups.set(month, [entry]);
  }
  return [...groups].map(([month, reports]) => ({ month, entries: reports }));
}

export function nearestDiaryEntry(entries: DiaryEntry[], date: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date)
    throw new Error("diary.invalid_date");
  let nearest: DiaryEntry | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const next = Math.abs(Date.parse(`${entry.entry_date}T00:00:00Z`) - target);
    if (next < distance) {
      nearest = entry;
      distance = next;
    }
  }
  return nearest;
}

export function diaryEntryTrades(
  entry: DiaryEntry,
  ws: Pick<Workspace, "tasks" | "events" | "offers" | "expenses">,
) {
  const taskIds = new Set(parseDiaryIds(entry.task_ids));
  const eventIds = new Set(parseDiaryIds(entry.event_ids));
  const offerIds = new Set(parseDiaryIds(entry.offer_ids));
  const paymentIds = new Set(parseDiaryIds(entry.payment_ids));
  return new Set([
    ...parseDiaryIds(entry.trade_ids),
    ...ws.tasks.flatMap((task) => (taskIds.has(task.id) && task.trade_id ? [task.trade_id] : [])),
    ...ws.events.flatMap((event) =>
      eventIds.has(event.id) && event.trade_id ? [event.trade_id] : [],
    ),
    ...ws.offers.flatMap((offer) =>
      offerIds.has(offer.id) && offer.trade_id ? [offer.trade_id] : [],
    ),
    ...ws.expenses.flatMap((expense) =>
      paymentIds.has(expense.id) && expense.trade_id ? [expense.trade_id] : [],
    ),
  ]);
}

export function filterDiaryEntries(
  ws: Pick<
    Workspace,
    "diary_entries" | "diary_media" | "tasks" | "events" | "trades" | "offers" | "expenses"
  >,
  filters: DiaryFilters,
) {
  const query = filters.search.trim().toLocaleLowerCase();
  return ws.diary_entries
    .filter((entry) => {
      if (filters.from && entry.entry_date < filters.from) return false;
      if (filters.to && entry.entry_date > filters.to) return false;
      const trades = diaryEntryTrades(entry, ws);
      if (filters.tradeId && !trades.has(filters.tradeId)) return false;
      if (!query) return true;
      const tasks = new Set(parseDiaryIds(entry.task_ids));
      const events = new Set(parseDiaryIds(entry.event_ids));
      const offers = new Set(parseDiaryIds(entry.offer_ids));
      const payments = new Set(parseDiaryIds(entry.payment_ids));
      const text = [
        entry.title,
        entry.work_done,
        entry.progress,
        entry.issues,
        ...ws.tasks.filter((task) => tasks.has(task.id)).map((task) => task.title),
        ...ws.events.filter((event) => events.has(event.id)).map((event) => event.title),
        ...ws.offers
          .filter((offer) => offers.has(offer.id))
          .flatMap((offer) => [offer.title, offer.contractor]),
        ...ws.expenses
          .filter((expense) => payments.has(expense.id))
          .flatMap((expense) => [expense.title, expense.vendor]),
        ...ws.trades.filter((trade) => trades.has(trade.id)).map((trade) => trade.name),
        ...ws.diary_media
          .filter((media) => media.diary_entry_id === entry.id)
          .map((media) => media.name),
      ];
      return text.some((value) => value?.toLocaleLowerCase().includes(query));
    })
    .sort(
      (left, right) =>
        right.entry_date.localeCompare(left.entry_date) ||
        (right.created_at ?? "").localeCompare(left.created_at ?? "") ||
        left.id.localeCompare(right.id),
    );
}

export function diaryConditionKey(code: number) {
  if (code === 0) return "diary.condition_clear";
  if (code === 1) return "diary.condition_mostly_clear";
  if (code === 2) return "diary.condition_partly_cloudy";
  if (code === 3) return "diary.condition_overcast";
  if (code === 45 || code === 48) return "diary.condition_fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "diary.condition_drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "diary.condition_rain";
  if ([71, 73, 75, 77].includes(code)) return "diary.condition_snow";
  if ([80, 81, 82].includes(code)) return "diary.condition_showers";
  if ([85, 86].includes(code)) return "diary.condition_snow_showers";
  if ([95, 96, 99].includes(code)) return "diary.condition_thunderstorm";
  return "diary.condition_unknown";
}
