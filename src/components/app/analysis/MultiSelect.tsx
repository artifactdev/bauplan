import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { tr } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string };

/** Searchable multi-select; an empty selection means "all". */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.filter((option) => value.includes(option.value));
  const summary =
    selected.length === 0
      ? tr("analysis.all")
      : selected.length === 1
        ? selected[0]!.label
        : tr("analysis.n_selected", { count: selected.length });
  const toggle = (item: string) =>
    onChange(value.includes(item) ? value.filter((entry) => entry !== item) : [...value, item]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${label}: ${summary}`}
          className={cn(
            "h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 text-left font-normal",
            className,
          )}
        >
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{label}</span>
            <span className={cn("block truncate text-sm", value.length > 0 && "font-medium")}>
              {summary}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={tr("analysis.search")} />
          <CommandList>
            <CommandEmpty>{tr("analysis.no_results")}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => toggle(option.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.includes(option.value) ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {value.length > 0 && (
          <div className="border-t p-1">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
              {tr("analysis.clear_selection")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
