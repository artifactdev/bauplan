import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { CalendarItem } from "@/lib/calendar-view";
import { CalendarViews } from "./CalendarViews";

const open = vi.fn();
const create = vi.fn();
const entries: CalendarItem[] = [
  {
    id: "event",
    title: "Site visit",
    date: "2026-10-28",
    end: "2026-10-28",
    label: "28 Oct, 09:00–10:00",
    start_time: "09:00",
    end_time: "10:00",
    kind: "termin",
    trade_id: null,
    source: { type: "event", id: "event" },
  },
  {
    id: "task",
    title: "Multi-day task",
    date: "2026-10-27",
    end: "2026-10-30",
    label: "27–30 Oct",
    start_time: null,
    kind: "aufgabe",
    trade_id: null,
    deadline: "2026-10-30",
    source: { type: "task", id: "task" },
  },
];
function mount(items = entries) {
  function Calendar() {
    const [selected, setSelected] = useState("2026-10-28");
    return (
      <CalendarViews
        items={items}
        selected={selected}
        onSelect={setSelected}
        onOpen={open}
        onCreate={create}
      />
    );
  }
  render(<Calendar />);
}
function selectView(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), {
    button: 0,
    ctrlKey: false,
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("calendar views", () => {
  it("keeps all five icon tabs named and provides a compact-month count with day drilldown", () => {
    mount();
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Agenda",
      "Day",
      "Week",
      "Month",
      "Year",
    ]);
    for (const name of ["Day", "Week", "Month", "Year", "Agenda"]) {
      expect(screen.getByRole("tab", { name }).querySelector("svg")).not.toBeNull();
    }
    const day = screen.getByRole("button", { name: "Wednesday, 28 October 2026" });
    expect(day).toHaveAttribute("aria-description", "2 entries");
    fireEvent.click(day);
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
    expect(
      within(screen.getByRole("region", { name: "Day" })).getByRole("button", {
        name: /Site visit/,
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Multi-day task/ })).toBeVisible();
  });
  it("uses a readable timed card and offers the day shortcut from the week", () => {
    mount();
    selectView("Week");
    const entry = screen.getByRole("button", { name: /Site visit/ });
    expect(entry).toHaveAttribute("data-calendar-entry", "timed");
    expect(within(entry).getByText("09:00–10:00")).toBeInTheDocument();
    expect(entry).toHaveAttribute("title", "Site visit · 28 Oct, 09:00–10:00");
    fireEvent.click(screen.getByRole("button", { name: "Open day view" }));
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
  });
  it("puts the full title, period and trade into one clickable agenda card", () => {
    mount([{ ...entries[0]!, tradeLabel: "Electrical work" }]);
    selectView("Agenda");
    const entry = screen.getByRole("button", { name: /Site visit/ });
    expect(entry).toHaveAttribute("data-calendar-entry", "agenda");
    expect(within(entry).getByText("28 Oct, 09:00–10:00")).toBeVisible();
    fireEvent.click(within(entry).getByText(/Electrical work/));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ source: entries[0]!.source }));
  });
  it("renders a multi-day month entry as one continuous four-column bar", () => {
    mount();
    const bars = screen.getAllByRole("button", { name: /Multi-day task/ });
    expect(bars).toHaveLength(1);
    expect(bars[0]!.parentElement).toHaveStyle({ gridColumn: "2 / span 4" });
  });
  it("places timed multi-day appointments above the week timeline as a single spanning bar", () => {
    const multi = { ...entries[0]!, date: "2026-10-27", end: "2026-10-30" };
    mount([multi]);
    selectView("Week");
    const bars = screen.getAllByRole("button", { name: /Site visit/ });
    expect(bars).toHaveLength(1);
    expect(bars[0]!.parentElement).toHaveStyle({ gridColumn: "3 / span 4" });
    expect(screen.getByText("Multi-day", { exact: true })).toBeVisible();
    fireEvent.click(bars[0]!);
    expect(open).toHaveBeenCalledWith(multi);
    selectView("Day");
    expect(screen.getByText("Day 2 of 4", { exact: false })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Site visit/ })).toHaveLength(1);
  });
  for (const view of ["Month", "Day", "Week", "Agenda"]) {
    it(`opens original records in ${view} without writing data`, () => {
      mount();
      selectView(view);
      const scope = view === "Day" ? within(screen.getByRole("region", { name: "Day" })) : screen;
      fireEvent.click(scope.getByRole("button", { name: /Site visit/ }));
      expect(open).toHaveBeenCalledWith(entries[0]);
      fireEvent.click(screen.getAllByRole("button", { name: /Multi-day task/ })[0]!);
      expect(open).toHaveBeenLastCalledWith(entries[1]);
      expect(create).not.toHaveBeenCalled();
    });
  }
  it("navigates months and years and returns to a selected day from year view", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeVisible();
    selectView("Year");
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    expect(screen.getByRole("heading", { name: "2027" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Wednesday, 10 February 2027" })[0]!);
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "10 February 2027" })).toBeVisible();
  });
  it("opens all entries through a crowded month's more button", () => {
    mount(
      Array.from({ length: 5 }, (_, index) => ({
        ...entries[0]!,
        id: `e${index}`,
        title: `Visit ${index}`,
        source: { type: "event", id: `e${index}` },
      })),
    );
    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(
      within(screen.getByRole("region", { name: "Day" })).getAllByRole("button", {
        name: /Visit \d/,
      }),
    ).toHaveLength(5);
  });
  it("prefills the existing appointment editor from an hour slot", () => {
    mount();
    selectView("Day");
    fireEvent.click(
      screen.getByRole("button", { name: "New appointment on 28 October 2026 at 14:00" }),
    );
    expect(create).toHaveBeenCalledWith("2026-10-28", "14:00");
  });
  it("opens timelines at midnight like the reference and keeps headers outside their scroll area", () => {
    mount();
    selectView("Day");
    expect(screen.getByRole("region", { name: "Day" }).scrollTop).toBe(0);
    expect(
      within(screen.getByRole("region", { name: "Day" })).queryByText("Day 2 of 4", {
        exact: false,
      }),
    ).not.toBeInTheDocument();
    selectView("Week");
    expect(screen.getByRole("region", { name: "Week" }).scrollTop).toBe(0);
  });
  it("uses 96 pixels per hour, half-hour creation targets, and 4-pixel card insets", () => {
    mount();
    selectView("Day");
    const region = screen.getByRole("region", { name: "Day" });
    const slot = within(region).getByRole("button", {
      name: "New appointment on 28 October 2026 at 14:30",
    });
    expect(slot).toHaveStyle({ top: "1392px", height: "48px" });
    fireEvent.click(slot);
    expect(create).toHaveBeenCalledWith("2026-10-28", "14:30");
    const entry = within(region).getByRole("button", { name: /Site visit/ });
    expect(entry.parentElement).toHaveStyle({ top: "864px", height: "96px" });
    expect(entry.parentElement).toHaveClass("p-1");
    expect(screen.getByRole("complementary", { name: "Day overview" })).toBeInTheDocument();
  });
  it("omits time text on appointments of 25 minutes or less", () => {
    mount([{ ...entries[0]!, end_time: "09:25" }]);
    selectView("Day");
    const card = within(screen.getByRole("region", { name: "Day" })).getByRole("button", {
      name: /Site visit/,
    });
    expect(card).toHaveAttribute("data-short", "true");
    expect(card.querySelector(".calendar-entry-time")).toBeNull();
  });
  it("updates the current-time marker every minute and only on today's date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 28, 9, 30));
    mount();
    selectView("Day");
    const region = screen.getByRole("region", { name: "Day" });
    expect(within(region).getByLabelText("Current time: 09:30")).toHaveStyle({ top: "912px" });
    act(() => vi.advanceTimersByTime(60_000));
    expect(within(region).getByLabelText("Current time: 09:31")).toHaveStyle({ top: "913.6px" });
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    expect(
      within(screen.getByRole("region", { name: "Day" })).queryByLabelText(/Current time:/),
    ).not.toBeInTheDocument();
  });
  it("includes ongoing overnight appointments but excludes those already ended at midnight", () => {
    mount([
      {
        ...entries[0]!,
        date: "2026-10-27",
        end: "2026-10-27",
        start_time: "23:30",
        end_time: null,
      },
      {
        ...entries[0]!,
        id: "ended",
        title: "Ended at midnight",
        date: "2026-10-27",
        end: "2026-10-28",
        start_time: "23:00",
        end_time: "00:00",
        source: { type: "event", id: "ended" },
      },
    ]);
    selectView("Agenda");
    expect(screen.getByRole("button", { name: /Site visit/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Ended at midnight/ })).not.toBeInTheDocument();
  });
  it("defaults to agenda on narrow screens", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    mount();
    expect(screen.getByRole("tab", { name: "Agenda" })).toHaveAttribute("aria-selected", "true");
  });
});
