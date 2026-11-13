export type CsvCell = string | number | null | undefined;

/**
 * Excel-friendly CSV: semicolon-separated with a UTF-8 BOM; decimal comma for German locales.
 * Cells starting with a formula character are prefixed so spreadsheets do not execute them.
 */
export function toCsv(rows: CsvCell[][], locale: string) {
  const comma = locale.toLowerCase().startsWith("de");
  const cell = (value: CsvCell) => {
    if (value === null || value === undefined) return "";
    let text = typeof value === "number" ? String(value) : value;
    if (typeof value === "number" && comma) text = text.replace(".", ",");
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text)))
      text = `'${text}`;
    return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `\uFEFF${rows.map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
}

export function downloadCsv(name: string, rows: CsvCell[][], locale: string) {
  const blob = new Blob([toCsv(rows, locale)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
