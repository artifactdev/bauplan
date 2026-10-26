import { useTranslation } from "react-i18next";
import { LANGUAGES, setLanguage, type Lang } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function LanguageSelect({ id }: { id?: string }) {
  const { i18n } = useTranslation();
  return (
    <Select value={i18n.language} onValueChange={(v) => setLanguage(v as Lang)}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
