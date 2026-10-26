import { currentLocale } from "@/i18n";

const fmtCache = new Map<string, Intl.NumberFormat>();
function eurFmt(cents: boolean) {
  const key = `${currentLocale()}|${cents}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(currentLocale(), { style: "currency", currency: "EUR", ...(cents ? {} : { maximumFractionDigits: 0 }) });
    fmtCache.set(key, f);
  }
  return f;
}

export const eur = (n: number | null | undefined, cents = false) => eurFmt(cents).format(Number(n ?? 0));

export function fmtDate(d: string | null | undefined) {
  if (!d) return "–";
  const [y = 0, m = 1, day = 1] = d.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(currentLocale(), { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(y, m - 1, day));
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fileSize(n: number | null | undefined) {
  const b = Number(n ?? 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
