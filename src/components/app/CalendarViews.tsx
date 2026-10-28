import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { addDays, addMonths, addYears, differenceInCalendarDays, startOfWeek } from "date-fns";
import { de, enGB } from "date-fns/locale";
import {
  CalendarDays,
  CalendarRange,
  Columns3,
  Grid2X2,
  List,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { currentLocale, tr } from "@/i18n";
import {
  dateKey,
  localDate,
  monthDays,
  onDay,
  timedLayout,
  rangeLayout,
  isMultiDay,
  lastDay,
  type CalendarItem,
  type CalendarView,
} from "@/lib/calendar-view";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty } from "./ui-bits";

const kinds = {
  termin: { label: "shared.appointment", dot: "bg-info", surface: "bg-info-subtle text-info" },
  frist: {
    label: "shared.deadline",
    dot: "bg-destructive",
    surface: "bg-destructive-subtle text-destructive",
  },
  arbeit: { label: "shared.work", dot: "bg-primary", surface: "bg-accent text-accent-foreground" },
  aufgabe: {
    label: "shared.task",
    dot: "bg-warning",
    surface: "bg-warning-subtle text-warning-foreground",
  },
};
const views: CalendarView[] = ["agenda", "day", "week", "month", "year"];
const hourHeight = 96;
const pixelsPerMinute = hourHeight / 60;
const viewIcons = {
  day: List,
  week: Columns3,
  month: CalendarDays,
  year: Grid2X2,
  agenda: CalendarRange,
};

export function CalendarViews({
  items,
  selected,
  onSelect,
  onOpen,
  onCreate,
}: {
  items: CalendarItem[];
  selected: string;
  onSelect: (date: string) => void;
  onOpen: (item: CalendarItem) => void;
  onCreate: (date: string, time?: string) => void;
}) {
  const { t } = useTranslation("calendar-view");
  const locale = currentLocale();
  const [view, setView] = useState<CalendarView>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
      ? "agenda"
      : "month",
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const date = localDate(selected);
  const today = dateKey(new Date());
  const fmt = (date: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(date);
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    fmt(addDays(startOfWeek(date, { weekStartsOn: 1 }), index), { weekday: "short" }),
  );
  const title =
    view === "year"
      ? String(date.getFullYear())
      : view === "day"
        ? fmt(date, { day: "numeric", month: "long", year: "numeric" })
        : view === "week"
          ? `${fmt(startOfWeek(date, { weekStartsOn: 1 }), { day: "numeric", month: "short" })} – ${fmt(addDays(startOfWeek(date, { weekStartsOn: 1 }), 6), { day: "numeric", month: "short", year: "numeric" })}`
          : fmt(date, { month: "long", year: "numeric" });
  const move = (direction: number) =>
    onSelect(
      dateKey(
        view === "year"
          ? addYears(date, direction)
          : view === "day"
            ? addDays(date, direction)
            : view === "week"
              ? addDays(date, direction * 7)
              : addMonths(date, direction),
      ),
    );
  const openDay = (day: string) => {
    onSelect(day);
    setView("day");
  };
  const eventButton = (
    item: CalendarItem,
    {
      variant = "bar",
      prefix,
      continuesBefore = false,
      continuesAfter = false,
      duration,
    }: {
      variant?: "month" | "bar" | "timed" | "agenda" | "current";
      prefix?: string | undefined;
      continuesBefore?: boolean;
      continuesAfter?: boolean;
      duration?: number;
    } = {},
  ) => (
    <button
      key={`${item.source.type}-${item.id}`}
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${item.title} · ${item.label}`}
      title={`${item.title} · ${item.label}`}
      data-calendar-entry={variant}
      data-short={(variant === "timed" && duration !== undefined && duration < 35) || undefined}
      className={cn(
        "calendar-entry w-full min-w-0 rounded-md text-left text-xs transition-[filter,box-shadow] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1",
        variant !== "current" && kinds[item.kind].surface,
        item.done && "line-through opacity-50",
        item.deadline && item.deadline < today && !item.done && "text-destructive",
        continuesBefore && "rounded-l-none",
        continuesAfter && "rounded-r-none",
      )}
      data-continues-before={continuesBefore || undefined}
      data-continues-after={continuesAfter || undefined}
    >
      <span className="calendar-entry-title">
        {prefix && <span className="calendar-entry-prefix">{prefix} · </span>}
        <span>{item.title}</span>
      </span>
      {(variant === "agenda" ||
        variant === "current" ||
        (item.start_time && (duration === undefined || duration > 25))) && (
        <span className="calendar-entry-time tabular">
          {variant === "agenda" || variant === "current"
            ? item.label
            : item.start_time
              ? `${item.start_time}${item.end_time ? `–${item.end_time}` : ""}`
              : t("allDay")}
        </span>
      )}
      {(variant === "agenda" || variant === "current") && (
        <span className="calendar-entry-meta">
          {tr(kinds[item.kind].label)}
          {item.tradeLabel && <> · {item.tradeLabel}</>}
        </span>
      )}
    </button>
  );
  const monthGrid = (month: Date, mini = false) =>
    !mini ? (
      <div>
        <div className="grid grid-cols-7 border-b">
          {weekdays.map((day) => (
            <div key={day} className="py-2 text-center text-xs text-muted-foreground">
              {day}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => {
          const days = monthDays(month).slice(week * 7, week * 7 + 7);
          const segments = rangeLayout(items, days.map(dateKey));
          return (
            <div
              key={week}
              className="calendar-month-week grid grid-cols-7 border-b last:border-b-0"
            >
              {days.map((day, column) => (
                <div
                  key={dateKey(day)}
                  className={cn(
                    "border-r last:border-r-0",
                    day.getMonth() !== month.getMonth() && "bg-muted/50",
                  )}
                  style={{ gridColumn: column + 1, gridRow: "1 / -1" }}
                />
              ))}
              {days.map((day, column) => {
                const entries = items.filter((item) => onDay(item, dateKey(day)));
                return (
                  <button
                    key={dateKey(day)}
                    type="button"
                    onClick={() => openDay(dateKey(day))}
                    aria-label={fmt(day, { dateStyle: "full" })}
                    aria-current={dateKey(day) === today ? "date" : undefined}
                    aria-description={t("entryCount", {
                      count: entries.length,
                    })}
                    className={cn(
                      "calendar-month-day z-0 flex min-w-0 flex-col items-center text-xs hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]",
                      day.getMonth() !== month.getMonth() && "text-muted-foreground",
                    )}
                    style={{ gridColumn: column + 1 }}
                  >
                    <span
                      className={cn(
                        "calendar-date-number flex size-8 shrink-0 items-center justify-center rounded-full font-medium",
                        dateKey(day) === today && "bg-primary text-primary-foreground",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    <span className="calendar-month-dots" aria-hidden="true">
                      {entries.slice(0, 3).map((item) => (
                        <span
                          key={`${item.source.type}-${item.id}`}
                          className={cn("size-1.5 rounded-full", kinds[item.kind].dot)}
                        />
                      ))}
                    </span>
                    {entries.length > 3 && (
                      <span className="calendar-month-count" aria-hidden="true">
                        +{entries.length - 3}
                      </span>
                    )}
                  </button>
                );
              })}
              {segments
                .filter((segment) => segment.row < 3)
                .map((segment) => (
                  <div
                    key={`${segment.item.source.type}-${segment.item.id}`}
                    className="calendar-month-entry z-0 mx-0.5 min-w-0"
                    style={{
                      gridColumn: `${segment.start + 1} / span ${segment.end - segment.start + 1}`,
                      gridRow: segment.row + 2,
                    }}
                  >
                    {eventButton(segment.item, {
                      variant: "month",
                      continuesBefore: segment.continuesBefore,
                      continuesAfter: segment.continuesAfter,
                    })}
                  </div>
                ))}
              {days.map((day, column) => {
                const hidden = segments.filter(
                  (segment) => segment.row >= 3 && segment.start <= column && segment.end >= column,
                ).length;
                return (
                  hidden > 0 && (
                    <button
                      key={dateKey(day)}
                      type="button"
                      onClick={() => openDay(dateKey(day))}
                      className="calendar-month-more z-0 rounded px-1 text-left text-xs text-muted-foreground hover:bg-accent"
                      style={{ gridColumn: column + 1, gridRow: 5 }}
                    >
                      {t("more", { count: hidden })}
                    </button>
                  )
                );
              })}
            </div>
          );
        })}
      </div>
    ) : (
      <div className="grid grid-cols-7 gap-px bg-border">
        {weekdays.map((day) => (
          <div key={day} className="bg-card py-2 text-center text-xs text-muted-foreground">
            {day}
          </div>
        ))}
        {monthDays(month).map((cell) => {
          const key = dateKey(cell);
          const entries = items.filter((item) => onDay(item, key));
          const outside = cell.getMonth() !== month.getMonth();
          return (
            <div key={key} className={cn("min-w-0 bg-card", outside && "bg-muted/50")}>
              <button
                type="button"
                onClick={() => openDay(key)}
                aria-label={fmt(cell, { dateStyle: "full" })}
                aria-current={key === today ? "date" : undefined}
                className={cn(
                  "mx-auto flex aspect-square w-full max-w-9 items-center justify-center rounded-full text-xs tabular hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                  outside && "text-muted-foreground",
                  key === today && "bg-primary text-primary-foreground",
                )}
              >
                {cell.getDate()}
              </button>
              <div className="flex h-2 justify-center gap-0.5">
                {entries.slice(0, 3).map((item) => (
                  <span
                    key={`${item.source.type}-${item.id}`}
                    className={cn("size-1 rounded-full", kinds[item.kind].dot)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  const timeGrid = () => {
    const days =
      view === "day"
        ? [date]
        : Array.from({ length: 7 }, (_, index) =>
            addDays(startOfWeek(date, { weekStartsOn: 1 }), index),
          );
    const spanning = rangeLayout(
      items.filter((item) => isMultiDay(item) || !item.start_time),
      days.map(dateKey),
    );
    const spanningRows = Math.max(0, ...spanning.map((segment) => segment.row + 1));
    const current = timedLayout(
      items.filter((item) => !isMultiDay(item)),
      dateKey(now),
    ).filter(
      ({ start, end }) =>
        start <= now.getHours() * 60 + now.getMinutes() &&
        end > now.getHours() * 60 + now.getMinutes(),
    );
    return (
      <>
        {view === "week" && (
          <div className="calendar-week-hint border-b p-4 text-center text-sm text-muted-foreground">
            {t("weekHint")}{" "}
            <button
              type="button"
              className="min-h-11 font-medium text-primary underline underline-offset-4"
              onClick={() => setView("day")}
            >
              {t("openDay")}
            </button>
          </div>
        )}
        <div className={cn("calendar-time-layout", view === "day" && "calendar-day-layout")}>
          <div className="min-w-0 flex-1">
            <div
              className="calendar-time-header grid border-b"
              style={{
                gridTemplateColumns: `var(--calendar-gutter) repeat(${days.length}, minmax(0, 1fr))`,
              }}
            >
              {spanningRows > 0 && (
                <>
                  <div
                    className="calendar-gutter-label border-t p-1 text-[0.625rem] text-muted-foreground"
                    aria-label={t("multiDay")}
                    style={{ gridColumn: 1, gridRow: `1 / span ${spanningRows}` }}
                  >
                    <span className="sr-only">{t("multiDay")}</span>
                  </div>
                  {spanning.map((segment) => (
                    <div
                      key={`${segment.item.source.type}-${segment.item.id}`}
                      className="calendar-range-entry min-w-0 py-0.5"
                      style={{
                        gridColumn: `${segment.start + 2} / span ${segment.end - segment.start + 1}`,
                        gridRow: segment.row + 1,
                      }}
                    >
                      {eventButton(segment.item, {
                        prefix:
                          view === "day" && isMultiDay(segment.item)
                            ? t("dayOf", {
                                current:
                                  differenceInCalendarDays(date, localDate(segment.item.date)) + 1,
                                total:
                                  differenceInCalendarDays(
                                    localDate(lastDay(segment.item)),
                                    localDate(segment.item.date),
                                  ) + 1,
                              })
                            : undefined,
                        continuesBefore: segment.continuesBefore,
                        continuesAfter: segment.continuesAfter,
                      })}
                    </div>
                  ))}
                </>
              )}
              <div style={{ gridColumn: 1, gridRow: spanningRows + 1 }} />
              {days.map((day, column) => (
                <button
                  key={dateKey(day)}
                  type="button"
                  onClick={() => openDay(dateKey(day))}
                  className={cn(
                    "calendar-time-day border-l py-2 text-center text-xs text-muted-foreground hover:bg-accent",
                    dateKey(day) === today && "text-primary",
                  )}
                  style={{ gridColumn: column + 2, gridRow: spanningRows + 1 }}
                >
                  <span className="calendar-time-weekday">{fmt(day, { weekday: "short" })}</span>{" "}
                  <span className="font-semibold">{day.getDate()}</span>
                </button>
              ))}
            </div>
            <div
              role="region"
              aria-label={t(view)}
              tabIndex={0}
              className={cn(
                "calendar-timeline overflow-y-scroll overflow-x-hidden focus-visible:outline-2 focus-visible:outline-ring",
                view === "day" ? "calendar-day-timeline" : "calendar-week-timeline",
              )}
            >
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `var(--calendar-gutter) repeat(${days.length}, minmax(0, 1fr))`,
                }}
              >
                <div className="relative" style={{ height: hourHeight * 24 }}>
                  {Array.from(
                    { length: 24 },
                    (_, hour) =>
                      hour > 0 && (
                        <span
                          key={hour}
                          className="absolute right-2 -translate-y-1/2 text-xs tabular text-muted-foreground"
                          style={{ top: hour * hourHeight }}
                        >{`${String(hour).padStart(2, "0")}:00`}</span>
                      ),
                  )}
                </div>
                {days.map((day) => (
                  <div
                    key={dateKey(day)}
                    className="relative min-w-0 border-l"
                    style={{ height: hourHeight * 24 }}
                  >
                    {Array.from({ length: 48 }, (_, slot) => {
                      const hour = Math.floor(slot / 2);
                      const time = `${String(hour).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => onCreate(dateKey(day), time)}
                          aria-label={t("createAt", {
                            date: fmt(day, { dateStyle: "long" }),
                            time,
                          })}
                          className={cn(
                            "absolute w-full hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring",
                            slot > 0 && "border-t",
                            slot % 2 === 1 && "border-dashed",
                          )}
                          style={{ top: (slot * hourHeight) / 2, height: hourHeight / 2 }}
                        />
                      );
                    })}
                    {timedLayout(
                      items.filter((item) => !isMultiDay(item)),
                      dateKey(day),
                    ).map(({ item, start, end, column, columns }) => (
                      <div
                        key={`${item.source.type}-${item.id}`}
                        className="absolute min-w-0 p-1"
                        style={{
                          top: start * pixelsPerMinute,
                          height: Math.max(16, (end - start) * pixelsPerMinute),
                          left: `${(column / columns) * 100}%`,
                          width: `${100 / columns}%`,
                        }}
                      >
                        {eventButton(item, { variant: "timed", duration: end - start })}
                      </div>
                    ))}
                    {dateKey(day) === dateKey(now) && (
                      <div
                        aria-label={t("currentTime", {
                          time: fmt(now, { hour: "2-digit", minute: "2-digit" }),
                        })}
                        className="calendar-now pointer-events-none absolute inset-x-0 border-t border-primary"
                        style={{ top: (now.getHours() * 60 + now.getMinutes()) * pixelsPerMinute }}
                      >
                        <span className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-primary" />
                        {view === "day" && (
                          <span className="absolute right-full mr-2 -translate-y-1/2 bg-card text-xs font-medium tabular text-primary">
                            {fmt(now, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {view === "day" && (
            <aside className="calendar-day-sidebar border-l" aria-label={t("dayOverview")}>
              <Calendar
                mode="single"
                selected={date}
                defaultMonth={date}
                key={selected}
                locale={locale.startsWith("de") ? de : enGB}
                weekStartsOn={1}
                onSelect={(day) => day && onSelect(dateKey(day))}
                className="mx-auto"
              />
              <section className="border-t p-4">
                <h3 className="mb-3 text-sm font-semibold">{t("happeningNow")}</h3>
                {current.length ? (
                  <ul className="flex max-h-[422px] flex-col gap-6 overflow-y-auto">
                    {current.map(({ item }) => (
                      <li key={`${item.source.type}-${item.id}`}>
                        {eventButton(item, { variant: "current" })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-center text-sm italic text-muted-foreground">
                    {t("nothingNow")}
                  </p>
                )}
              </section>
            </aside>
          )}
        </div>
      </>
    );
  };
  const agenda = () => {
    const overdue = items.filter((item) => item.deadline && item.deadline < today && !item.done);
    const upcoming = items.filter(
      (item) =>
        (item.date >= selected || onDay(item, selected)) && !item.done && !overdue.includes(item),
    );
    const groups = new Map<string, CalendarItem[]>();
    for (const item of upcoming) {
      const key = item.date < selected ? selected : item.date;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const rows = (entries: CalendarItem[]) => (
      <ul className="flex flex-col gap-2">
        {entries.map((item) => (
          <li key={`${item.source.type}-${item.id}`} className="min-w-0">
            {eventButton(item, { variant: "agenda" })}
          </li>
        ))}
      </ul>
    );
    return (
      <div className="flex flex-col gap-6 p-3 sm:p-5">
        {overdue.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold text-destructive">{tr("shared.overdue")}</h3>
            {rows(overdue)}
          </section>
        )}
        {[...groups]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, entries]) => (
            <section key={day}>
              <h3 className="mb-3 text-sm font-semibold">
                {fmt(localDate(day), {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </h3>
              {rows(entries)}
            </section>
          ))}
        {!upcoming.length && <Empty>{tr("calendar.nothing_planned")}</Empty>}
      </div>
    );
  };
  return (
    <section
      className="calendar-views min-w-0 overflow-hidden rounded-xl border bg-card"
      aria-label={tr("shared.calendar")}
    >
      <Tabs
        value={view}
        onValueChange={(value) => {
          if (views.includes(value as CalendarView)) setView(value as CalendarView);
        }}
      >
        <div className="calendar-toolbar border-b p-3 sm:p-4">
          <div className="calendar-navigation">
            <Button variant="outline" size="sm" onClick={() => onSelect(today)}>
              {t("today")}
            </Button>
            <Button size="icon" variant="ghost" aria-label={t("previous")} onClick={() => move(-1)}>
              <ChevronLeft />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t("next")} onClick={() => move(1)}>
              <ChevronRight />
            </Button>
            <h2
              className="calendar-period min-w-0 text-sm font-semibold sm:text-base"
              aria-live="polite"
            >
              {title}
            </h2>
          </div>
          <TabsList className="calendar-view-tabs">
            {views.map((value) => {
              const Icon = viewIcons[value];
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  aria-label={t(value)}
                  title={t(value)}
                  className="calendar-view-tab"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="calendar-view-label">{t(value)}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <TabsContent value="month" className="mt-0">
          {monthGrid(date)}
        </TabsContent>
        <TabsContent value="year" className="mt-0">
          <div className="calendar-year-grid">
            {Array.from({ length: 12 }, (_, month) => (
              <section key={month} className="min-w-0">
                <button
                  type="button"
                  className="mb-2 min-h-11 rounded px-2 font-semibold hover:bg-accent"
                  onClick={() => {
                    onSelect(dateKey(new Date(date.getFullYear(), month, 1)));
                    setView("month");
                  }}
                >
                  {fmt(new Date(date.getFullYear(), month, 1), { month: "long" })}
                </button>
                {monthGrid(new Date(date.getFullYear(), month, 1), true)}
              </section>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="day" className="mt-0">
          {view === "day" && timeGrid()}
        </TabsContent>
        <TabsContent value="week" className="mt-0">
          {view === "week" && timeGrid()}
        </TabsContent>
        <TabsContent value="agenda" className="mt-0">
          {view === "agenda" && agenda()}
        </TabsContent>
      </Tabs>
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t px-3 py-3 text-xs text-muted-foreground">
        {Object.values(kinds).map((kind) => (
          <span key={kind.label} className="flex items-center gap-1.5">
            <span className={cn("mr-1 inline-block size-1.5 rounded-full", kind.dot)} />
            {tr(kind.label)}
          </span>
        ))}
      </div>
    </section>
  );
}
