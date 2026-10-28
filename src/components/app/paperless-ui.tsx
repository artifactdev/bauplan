import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

function paperlessErrorKey(error: Error): string {
  return error.message.startsWith("paperless.")
    ? error.message.slice("paperless.".length)
    : error.message;
}

export function PaperlessError({ error }: { error: Error | null | undefined }) {
  const { t } = useTranslation("paperless");
  if (!error) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle />
      <AlertDescription>{t(paperlessErrorKey(error))}</AlertDescription>
    </Alert>
  );
}

export function PaperlessSelect({
  id,
  label,
  options,
  empty,
  className,
  ...props
}: Omit<ComponentProps<"select">, "id"> & {
  id: string;
  label: string;
  options: { id: number; name: string }[];
  empty: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={cn(
          "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <option value="">{empty}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}
