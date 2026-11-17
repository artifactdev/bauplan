import { z } from "zod";
import {
  diaryWeatherLocationSchema,
  diaryWeatherSchema,
  type DiaryWeatherLocation,
} from "@/lib/diary";

const weatherResponseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number().nullable()).optional(),
    temperature_2m_max: z.array(z.number().nullable()).optional(),
    temperature_2m_min: z.array(z.number().nullable()).optional(),
    precipitation_sum: z.array(z.number().nullable()).optional(),
  }),
});

async function getJson(url: URL) {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("diary.weather_unavailable");
  }
  if (!response.ok) throw new Error("diary.weather_unavailable");
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("diary.weather_invalid_response");
  }
}

export async function searchWeatherLocations(query: string): Promise<DiaryWeatherLocation[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: query,
    count: "5",
    language: "de",
    format: "json",
  }).toString();
  const payload = await getJson(url);
  const result = z.object({ results: z.array(z.unknown()).optional() }).safeParse(payload);
  if (!result.success) throw new Error("diary.weather_invalid_response");
  return (result.data.results ?? []).flatMap((item) => {
    const location = diaryWeatherLocationSchema.safeParse(item);
    return location.success ? [location.data] : [];
  });
}

function daysBeforeToday(date: string) {
  const selected = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.floor((today - selected) / 86_400_000);
}

export async function weatherForDate(
  latitude: number,
  longitude: number,
  date: string,
): Promise<z.infer<typeof diaryWeatherSchema>> {
  const parsedDate = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== date)
    throw new Error("diary.invalid_date");
  const difference = daysBeforeToday(date);
  if (difference < -15) throw new Error("diary.weather_unavailable_for_date");
  const source = difference > 5 ? "archive" : "forecast";
  const url = new URL(
    source === "archive"
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast",
  );
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "auto",
    ...(source === "archive"
      ? { start_date: date, end_date: date }
      : {
          past_days: "5",
          forecast_days: String(Math.max(1, 1 - difference)),
        }),
  }).toString();
  const payload = weatherResponseSchema.safeParse(await getJson(url));
  if (!payload.success) throw new Error("diary.weather_invalid_response");
  const index = payload.data.daily.time.indexOf(date);
  const daily = payload.data.daily;
  const code = daily.weather_code?.[index];
  if (index < 0 || typeof code !== "number") throw new Error("diary.weather_unavailable_for_date");
  const snapshot = diaryWeatherSchema.safeParse({
    date,
    code,
    temperatureMax: daily.temperature_2m_max?.[index] ?? null,
    temperatureMin: daily.temperature_2m_min?.[index] ?? null,
    precipitation: daily.precipitation_sum?.[index] ?? null,
    latitude,
    longitude,
    fetchedAt: new Date().toISOString(),
    source,
  });
  if (!snapshot.success) throw new Error("diary.weather_invalid_response");
  return snapshot.data;
}
