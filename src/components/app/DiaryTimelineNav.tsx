import { useId, useRef, useState } from "react";
import { CalendarSearch } from "lucide-react";
import * as Slider from "@radix-ui/react-slider";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tr } from "@/i18n";
import { cn } from "@/lib/utils";

type Props = {
  months: { month: string; entries: { entry_date: string }[] }[];
  activeMonth: string;
  onMonth: (month: string) => void;
  onDate: (date: string) => void;
};

export function DiaryTimelineNav({ months, activeMonth, onMonth, onDate }: Props) {
  const { i18n } = useTranslation();
  const inputId = useId();
  const helpId = useId();
  const track = useRef<HTMLSpanElement>(null);
  const dateJumped = useRef(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState("");
  const activeIndex = Math.max(
    0,
    months.findIndex((item) => item.month === activeMonth),
  );
  const label = (index: number) => {
    const item = months[index]!;
    const month = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(
      new Date(`${item.month}-01T00:00:00`),
    );
    return tr("diary.timeline_month", { month, count: item.entries.length });
  };
  const position = (index: number) => (months.length > 1 ? (index / (months.length - 1)) * 100 : 0);
  const jump = (index: number) => {
    const month = months[Math.max(0, Math.min(months.length - 1, index))]!.month;
    onMonth(month);
  };
  const indexAt = (clientY: number) => {
    const bounds = track.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        months.length - 1,
        Math.round(((clientY - bounds.top) / bounds.height) * (months.length - 1)),
      ),
    );
  };
  const years = months.flatMap((item, index) =>
    index === 0 || item.month.slice(0, 4) !== months[index - 1]!.month.slice(0, 4)
      ? [{ index, year: item.month.slice(0, 4) }]
      : [],
  );
  const yearStride = Math.max(1, Math.ceil(years.length / 7));

  return (
    <nav
      aria-label={tr("diary.time_navigation")}
      className="sticky top-24 flex h-[min(34rem,calc(100dvh-12rem))] min-h-32 w-11 shrink-0 flex-col items-center gap-2 self-start sm:w-20"
    >
      <Popover
        open={dateOpen}
        onOpenChange={(open) => {
          setDateOpen(open);
          if (open) {
            dateJumped.current = false;
            setDate(months[activeIndex]!.entries[0]!.entry_date);
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={tr("diary.jump_date")}>
                <CalendarSearch aria-hidden="true" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{tr("diary.jump_date")}</TooltipContent>
        </Tooltip>
        <PopoverContent
          aria-label={tr("diary.jump_date")}
          align="end"
          onCloseAutoFocus={(event) => {
            if (dateJumped.current) event.preventDefault();
          }}
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              dateJumped.current = true;
              onDate(date);
              setDateOpen(false);
            }}
          >
            <Label htmlFor={inputId}>{tr("diary.jump_date")}</Label>
            <Input
              id={inputId}
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{tr("diary.jump_date_help")}</p>
            <Button type="submit">{tr("diary.jump_to_report")}</Button>
          </form>
        </PopoverContent>
      </Popover>
      <p id={helpId} className="sr-only">
        {tr("diary.timeline_keyboard")}
      </p>
      <div className="relative w-full flex-1 py-3">
        <Slider.Root
          orientation="vertical"
          inverted
          min={0}
          max={Math.max(1, months.length - 1)}
          step={1}
          disabled={months.length < 2}
          value={[activeIndex]}
          onValueChange={([index]) => jump(index!)}
          onValueCommit={() => setHoverIndex(null)}
          className="relative flex h-full w-full touch-none cursor-ns-resize select-none flex-col items-end"
          onKeyDown={(event) => {
            if (event.key !== "PageUp" && event.key !== "PageDown") return;
            event.preventDefault();
            jump(activeIndex + (event.key === "PageUp" ? -12 : 12));
          }}
          onPointerMove={(event) => {
            setHoverIndex(indexAt(event.clientY));
          }}
          onPointerCancel={() => setHoverIndex(null)}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <Slider.Track ref={track} className="pointer-events-none relative h-full w-full">
            <span className="absolute inset-y-0 right-2 w-px bg-border" />
            {months.map((item, index) => (
              <span
                key={item.month}
                style={{ top: `${position(index)}%` }}
                className={cn(
                  "absolute right-1.5 size-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/50",
                  index === activeIndex && "bg-primary ring-2 ring-background",
                )}
              />
            ))}
            {years
              .filter((_, index) => index % yearStride === 0)
              .map(({ index, year }) => (
                <span
                  key={year}
                  style={{ top: `${position(index)}%` }}
                  className={cn(
                    "absolute right-4 -translate-y-1/2 text-[0.65rem] font-medium tabular-nums text-muted-foreground sm:right-5 sm:text-xs",
                    activeMonth.startsWith(year) && "text-foreground",
                  )}
                >
                  {year}
                </span>
              ))}
            {hoverIndex !== null && (
              <output
                aria-hidden="true"
                style={{ top: `${position(hoverIndex)}%` }}
                className="absolute right-full mr-1 -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
              >
                {label(hoverIndex)}
              </output>
            )}
          </Slider.Track>
          <Slider.Thumb
            aria-label={tr("diary.time_navigation")}
            aria-describedby={helpId}
            aria-valuetext={label(activeIndex)}
            className="block h-1 w-4 rounded-full bg-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          />
        </Slider.Root>
      </div>
    </nav>
  );
}
