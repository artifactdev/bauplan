import { useState } from "react";
import { toast } from "sonner";
import { useMutations } from "@/hooks/use-workspace";
import { searchWeatherLocations } from "@/lib/data.functions";
import type { DiaryWeatherLocation } from "@/lib/diary";
import type { Project } from "@/lib/schema";
import { tr } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/app/ui-bits";

export function ProjectWeatherSettings({ project }: { project: Project }) {
  const { update } = useMutations();
  const [query, setQuery] = useState(project.address ?? "");
  const [results, setResults] = useState<DiaryWeatherLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const search = async () => {
    setSearching(true);
    try {
      setResults(await searchWeatherLocations({ data: { query } }));
      setHasSearched(true);
    } catch (error) {
      setHasSearched(false);
      toast.error(error instanceof Error ? tr(error.message) : tr("diary.save_failed"));
    } finally {
      setSearching(false);
    }
  };

  const choose = async (location: DiaryWeatherLocation) => {
    try {
      await update.mutateAsync({
        table: "projects",
        id: project.id,
        patch: {
          weather_latitude: location.latitude,
          weather_longitude: location.longitude,
          weather_location_name: [location.name, location.admin1, location.country]
            .filter(Boolean)
            .join(", "),
        },
      });
      setResults([]);
      setHasSearched(false);
    } catch (error) {
      toast.error(error instanceof Error ? tr(error.message) : tr("diary.save_failed"));
    }
  };

  const clear = async () => {
    try {
      await update.mutateAsync({
        table: "projects",
        id: project.id,
        patch: {
          weather_latitude: null,
          weather_longitude: null,
          weather_location_name: null,
        },
      });
      setResults([]);
      setHasSearched(false);
    } catch (error) {
      toast.error(error instanceof Error ? tr(error.message) : tr("diary.save_failed"));
    }
  };

  return (
    <Panel title={tr("diary.weather_settings")}>
      <p className="mb-3 text-sm text-muted-foreground">{tr("diary.weather_settings_help")}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1.5">
          <Label htmlFor="weather-location-query">{tr("diary.weather_address")}</Label>
          <Input
            id="weather-location-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={200}
          />
        </div>
        <Button
          type="button"
          className="min-h-11 self-end"
          disabled={query.trim().length < 2 || searching}
          onClick={() => void search()}
        >
          {searching ? tr("shared.loading") : tr("diary.weather_search")}
        </Button>
      </div>
      {project.weather_latitude != null && project.weather_longitude != null && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{project.weather_location_name}</p>
            <p className="text-xs text-muted-foreground">
              {project.weather_latitude.toFixed(4)}, {project.weather_longitude.toFixed(4)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={update.isPending}
            onClick={() => void clear()}
          >
            {tr("diary.weather_clear_location")}
          </Button>
        </div>
      )}
      {results.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg border">
          {results.map((location) => (
            <li key={`${location.latitude},${location.longitude}`}>
              <button
                type="button"
                className="min-h-12 w-full px-3 py-2 text-left text-sm hover:bg-muted"
                disabled={update.isPending}
                onClick={() => void choose(location)}
              >
                <span className="block font-medium">
                  {[location.name, location.admin1, location.country].filter(Boolean).join(", ")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasSearched && results.length === 0 && !searching && (
        <p className="mt-3 text-sm text-muted-foreground">{tr("diary.weather_no_locations")}</p>
      )}
    </Panel>
  );
}
