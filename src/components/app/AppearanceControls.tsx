import { useTranslation } from "react-i18next";
import { Monitor, Moon, Sun } from "lucide-react";
import { MODES, PALETTES, appearanceSchema } from "@/lib/appearance";
import { useAppearance } from "./AppearanceProvider";
import { Panel } from "./ui-bits";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MODE_ICONS = { light: Sun, dark: Moon, system: Monitor };
const SWATCHES = { current: "#0e6375", blue: "#295cc5", green: "#176b50", violet: "#6d28d9" };

export function AppearancePanel() {
  const { t } = useTranslation("appearance");
  const { appearance, saving, setAppearance } = useAppearance();
  return (
    <Panel title={t("title")}>
      <fieldset className="space-y-5" aria-describedby="appearance-account-hint">
        <legend className="sr-only">{t("title")}</legend>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("palette")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {PALETTES.map((palette) => (
              <label
                key={palette}
                className="theme-choice min-w-0 cursor-pointer rounded-xl border border-input p-3 text-sm has-[:checked]:ring-2 has-[:checked]:ring-ring has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-ring"
              >
                <span
                  aria-hidden="true"
                  className="mb-3 flex h-16 overflow-hidden rounded-md border border-border bg-background"
                >
                  <span className="w-1/4 bg-sidebar p-1.5">
                    <span
                      className="mb-1 block h-1 rounded"
                      style={{ backgroundColor: SWATCHES[palette] }}
                    />
                    <span className="block h-1 rounded bg-input" />
                  </span>
                  <span className="grid flex-1 grid-cols-2 gap-1.5 p-2">
                    <span className="rounded bg-card" />
                    <span className="rounded bg-card" />
                    <span
                      className="col-span-2 rounded opacity-70"
                      style={{ backgroundColor: SWATCHES[palette] }}
                    />
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="appearance-palette"
                    value={palette}
                    checked={appearance.palette === palette}
                    onChange={() => setAppearance({ ...appearance, palette })}
                    className="accent-primary"
                  />
                  {t(palette)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("mode")}</legend>
          <div className="flex flex-wrap gap-2">
            {MODES.map((mode) => (
              <label
                key={mode}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 text-sm has-[:checked]:bg-accent has-[:checked]:text-accent-foreground"
              >
                <input
                  type="radio"
                  name="appearance-mode"
                  value={mode}
                  checked={appearance.mode === mode}
                  onChange={() => setAppearance({ ...appearance, mode })}
                  className="accent-primary"
                />
                {t(mode)}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      <p id="appearance-account-hint" className="mt-4 text-sm text-muted-foreground">
        {t("accountHint")}
      </p>
      <p
        role="status"
        aria-label={t("title")}
        className="mt-2 min-h-5 text-sm text-muted-foreground"
      >
        {saving ? t("saving") : ""}
      </p>
    </Panel>
  );
}

export function AppearanceModeMenu() {
  const { t } = useTranslation("appearance");
  const { appearance, setAppearance } = useAppearance();
  const Icon = MODE_ICONS[appearance.mode];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("quickMode", { mode: t(appearance.mode) })}
        >
          <Icon className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={appearance.mode}
          onValueChange={(mode) => {
            setAppearance(appearanceSchema.parse({ ...appearance, mode }));
          }}
        >
          {MODES.map((mode) => {
            const ModeIcon = MODE_ICONS[mode];
            return (
              <DropdownMenuRadioItem key={mode} value={mode} className="min-h-11">
                <ModeIcon className="mr-2 h-4 w-4" />
                {t(mode)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
