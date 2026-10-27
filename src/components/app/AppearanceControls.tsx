import { useTranslation } from "react-i18next";
import { MODES } from "@/lib/appearance";
import { useAppearance } from "./AppearanceProvider";
import { Panel } from "./ui-bits";
export function AppearancePanel() {
  const { t } = useTranslation("appearance");
  const { appearance, saving, setAppearance } = useAppearance();
  return (
    <Panel title={t("title")}>
      <fieldset className="flex flex-col gap-5" aria-describedby="appearance-account-hint">
        <legend className="sr-only">{t("title")}</legend>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("primaryColor")}</legend>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
            <label
              className="flex size-12 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring"
              style={{ backgroundColor: appearance.primaryColor }}
            >
              <input
                type="color"
                aria-label={t("primaryColor")}
                value={appearance.primaryColor}
                onChange={(event) =>
                  setAppearance({ ...appearance, primaryColor: event.currentTarget.value })
                }
                className="size-14 cursor-pointer opacity-0"
              />
            </label>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{appearance.primaryColor.toUpperCase()}</div>
              <p className="text-sm text-muted-foreground">{t("primaryColorHint")}</p>
            </div>
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="size-5 rounded" style={{ backgroundColor: "var(--primary)" }} />
              <span className="size-5 rounded" style={{ backgroundColor: "var(--accent)" }} />
            </div>
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
