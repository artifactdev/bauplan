import { tr } from "@/i18n";
import { useState } from "react";
import { Check, Plus, Tag, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { splitTags, toggleTag } from "@/lib/tags";
import { cn } from "@/lib/utils";

/** Tag picker: selected tags as removable badges plus a searchable list of existing tags. */
export function TagsInput({
  id,
  value,
  onChange,
  suggestions,
  className,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = splitTags(value);
  const selectedKeys = new Set(selected.map((t) => t.toLocaleLowerCase()));
  const available = suggestions.filter((t) => !selectedKeys.has(t.toLocaleLowerCase()));
  const trimmed = query.replace(/,/g, " ").trim();
  const known = new Set([...selected, ...suggestions].map((t) => t.toLocaleLowerCase()));
  const canCreate = !!trimmed && !known.has(trimmed.toLocaleLowerCase());

  const toggle = (tag: string) => {
    onChange(toggleTag(value, tag));
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 text-sm shadow-xs",
            className,
          )}
        >
          {selected.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1 font-normal">
              {tag}
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                aria-label={tr("tags.remove", { tag })}
                onClick={() => toggle(tag)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <PopoverTrigger asChild>
            <button
              id={id}
              type="button"
              role="combobox"
              aria-expanded={open}
              className="flex min-h-7 flex-1 items-center gap-1 rounded-sm px-1.5 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {selected.length ? <Plus className="h-3.5 w-3.5" /> : <Tag className="h-3.5 w-3.5" />}
              <span className="whitespace-nowrap">
                {selected.length ? tr("tags.add") : tr("tags.choose")}
              </span>
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput
            placeholder={tr("tags.search_or_create")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{tr("tags.none_found")}</CommandEmpty>
            {canCreate && (
              <CommandGroup>
                <CommandItem value={`__create__${trimmed}`} onSelect={() => toggle(trimmed)}>
                  <Plus className="h-4 w-4" />
                  {tr("tags.create", { tag: trimmed })}
                </CommandItem>
              </CommandGroup>
            )}
            {selected.length > 0 && (
              <CommandGroup heading={tr("tags.selected")}>
                {selected.map((tag) => (
                  <CommandItem key={tag} value={tag} onSelect={() => toggle(tag)}>
                    <Check className="h-4 w-4" />
                    {tag}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {available.length > 0 && (
              <CommandGroup heading={tr("tags.existing")}>
                {available.map((tag) => (
                  <CommandItem key={tag} value={tag} onSelect={() => toggle(tag)}>
                    <span className="h-4 w-4" />
                    {tag}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
