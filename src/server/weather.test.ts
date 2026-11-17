// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWeatherLocations, weatherForDate } from "./weather";

afterEach(() => vi.unstubAllGlobals());

describe("Open-Meteo weather integration", () => {
  it("uses the geocoding API and filters malformed locations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          { name: "Freiburg", latitude: 48, longitude: 8, country: "Deutschland" },
          { name: "Invalid", latitude: 100, longitude: 8 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeatherLocations("Freiburg")).resolves.toEqual([
      { name: "Freiburg", latitude: 48, longitude: 8, country: "Deutschland" },
    ]);
    const url = new URL(fetchMock.mock.calls[0]![0] as URL);
    expect(url.hostname).toBe("geocoding-api.open-meteo.com");
    expect(url.searchParams.get("name")).toBe("Freiburg");
  });

  it("requests forecast data and returns a dated snapshot without another lookup", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        daily: {
          time: [date],
          weather_code: [2],
          temperature_2m_max: [19],
          temperature_2m_min: [9],
          precipitation_sum: [0.2],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const weather = await weatherForDate(48, 8, date);

    expect(weather).toMatchObject({
      date,
      code: 2,
      temperatureMax: 19,
      temperatureMin: 9,
      precipitation: 0.2,
      latitude: 48,
      longitude: 8,
      source: "forecast",
    });
    expect(new URL(fetchMock.mock.calls[0]![0] as URL).hostname).toBe("api.open-meteo.com");
  });

  it("uses the archive endpoint for older report dates", async () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 10);
    const archivedDate = date.toISOString().slice(0, 10);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        daily: {
          time: [archivedDate],
          weather_code: [61],
          temperature_2m_max: [14],
          temperature_2m_min: [7],
          precipitation_sum: [2.4],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(weatherForDate(48, 8, archivedDate)).resolves.toMatchObject({
      date: archivedDate,
      source: "archive",
      code: 61,
    });
    expect(new URL(fetchMock.mock.calls[0]![0] as URL).hostname).toBe("archive-api.open-meteo.com");
  });
});
