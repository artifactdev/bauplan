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
const SWATCHES = { current: "#32674f", blue: "#1d4ed8", green: "#3f6212", violet: "#6d28d9" };

export function AppearancePanel() {
  const { t } = useTranslation("appearance");
  const { appearance, saving, setAppearance } = useAppearance();
  return (
    <Panel title={t("title")}>
      <fieldset disabled={saving} className="space-y-4">
        <legend className="sr-only">{t("title")}</legend>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("palette")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {PALETTES.map((palette) => (
              <label
                key={palette}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-input p-3 text-sm has-[:checked]:ring-2 has-[:checked]:ring-ring"
              >
                <input
                  type="radio"
                  name="appearance-palette"
                  value={palette}
                  checked={appearance.palette === palette}
                  onChange={() => setAppearance({ ...appearance, palette })}
                  className="accent-primary"
                />
                <span
                  aria-hidden="true"
                  className="h-5 w-5 rounded-full"
                  style={{ backgroundColor: SWATCHES[palette] }}
                />
                {t(palette)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("mode")}</legend>
          <div className="flex flex-wrap gap-3">
            {MODES.map((mode) => (
              <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm">
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
      <p className="mt-3 text-xs text-muted-foreground">{t("accountHint")}</p>
      {saving && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {t("saving")}
        </p>
      )}
    </Panel>
  );
}

export function AppearanceModeMenu() {
  const { t } = useTranslation("appearance");
  const { appearance, saving, setAppearance } = useAppearance();
  const Icon = MODE_ICONS[appearance.mode];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={saving}
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
              <DropdownMenuRadioItem key={mode} value={mode} disabled={saving}>
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
