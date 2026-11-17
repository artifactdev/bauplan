import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import i18n from "@/i18n";
import { getFileUrl } from "./data.functions";
import { getOfflineAccount, listUploads } from "./offline-store";
import { diaryConditionKey, parseDiaryIds, parseDiaryWeather } from "./diary";
import type { DiaryEntry, DiaryMedia, Project, Workspace } from "./schema";

declare const __PDFJS_ASSET_BASE__: string;

type PdfInput = {
  project: Project;
  workspace: Workspace;
  entries: DiaryEntry[];
  language: string;
  fonts: { regular: Uint8Array; bold: Uint8Array };
  photo: (media: DiaryMedia) => Promise<Uint8Array>;
};

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const INK = rgb(0.1, 0.16, 0.2);
const MUTED = rgb(0.37, 0.43, 0.47);
const ACCENT = rgb(0.06, 0.39, 0.44);
const PALE = rgb(0.92, 0.96, 0.96);
const WIDTH = PAGE.width - PAGE.margin * 2;

export async function createDiaryPdf(input: PdfInput) {
  if (!input.entries.length) throw new Error("diary.pdf_empty");
  const t = i18n.getFixedT(input.language, "ui");
  const date = (value: string) =>
    new Intl.DateTimeFormat(input.language, { dateStyle: "long" }).format(
      new Date(`${value}T00:00:00`),
    );
  const money = (value: number) =>
    new Intl.NumberFormat(input.language, { style: "currency", currency: "EUR" }).format(value);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(input.fonts.regular, { subset: true });
  const bold = await pdf.embedFont(input.fonts.bold, { subset: true });
  const supported = new Set(regular.getCharacterSet());
  const omitted: string[] = [];
  const entries = [...input.entries].sort(
    (left, right) =>
      left.entry_date.localeCompare(right.entry_date) || left.id.localeCompare(right.id),
  );
  pdf.setTitle(`${t("diary.title")} – ${input.project.name}`);
  pdf.setCreator(t("diary.pdf_brand"));
  pdf.setLanguage(input.language);
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    if (pdf.getPageCount() === 1)
      page.drawRectangle({
        x: 0,
        y: PAGE.height - 310,
        width: PAGE.width,
        height: 310,
        color: PALE,
      });
    y = PAGE.height - PAGE.margin;
    page.drawRectangle({ x: PAGE.margin, y: y - 2, width: 24, height: 3, color: ACCENT });
    page.drawText(t("diary.pdf_brand"), {
      x: PAGE.margin + 32,
      y: y - 4,
      size: 9,
      font: bold,
      color: ACCENT,
    });
    y -= 42;
  };
  const ensure = (height: number) => {
    if (y - height < 62) newPage();
  };
  const linesFor = (value: string, font: PDFFont, size: number, width: number) => {
    const text = value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    for (const character of text) {
      if (character !== "\n" && !supported.has(character.codePointAt(0)!))
        throw new Error("diary.pdf_unsupported_text");
    }
    return text.split("\n").flatMap((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        for (const character of word) {
          if (font.widthOfTextAtSize(line + character, size) > width && line) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
      }
      lines.push(line);
      return lines;
    });
  };
  const text = (value: string, size = 10.5, font = regular, color = INK, width = WIDTH) => {
    for (const line of linesFor(value, font, size, width)) {
      ensure(size * 1.5);
      page.drawText(line, { x: PAGE.margin, y, size, font, color });
      y -= size * 1.5;
    }
  };
  const section = (label: string, value: string | null | undefined) => {
    if (!value) return;
    ensure(62);
    y -= 12;
    text(label, 10, bold, ACCENT);
    y -= 3;
    text(value);
  };
  newPage();
  y -= 70;
  text(t("diary.title"), 34, bold, ACCENT);
  y -= 16;
  text(input.project.name, 22, bold);
  if (input.project.address) {
    y -= 8;
    text(input.project.address, 11, regular, MUTED);
  }
  y = Math.min(y - 60, PAGE.height - 370);
  text(t("diary.pdf_period"), 10, bold, ACCENT);
  text(`${date(entries[0]!.entry_date)} – ${date(entries.at(-1)!.entry_date)}`, 14);
  y -= 24;
  text(t("diary.pdf_report_count", { count: entries.length }), 12, bold);
  y -= 10;
  text(t("diary.pdf_description"), 11, regular, MUTED);
  y -= 20;
  text(t("diary.pdf_video_note"), 10, regular, MUTED);
  const generated = new Intl.DateTimeFormat(input.language, { dateStyle: "long" }).format(
    new Date(),
  );
  y -= 24;
  text(t("diary.pdf_created", { date: generated }), 10, regular, MUTED);

  for (const [index, entry] of entries.entries()) {
    newPage();
    text(t("diary.pdf_report_number", { number: index + 1 }), 9, bold, ACCENT);
    text(date(entry.entry_date), 12, regular, MUTED);
    y -= 10;
    text(entry.title, 22, bold);
    y -= 10;
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: PAGE.width - PAGE.margin, y },
      thickness: 1,
      color: PALE,
    });
    const weather = parseDiaryWeather(entry.weather_snapshot);
    if (weather) {
      section(
        t("diary.weather"),
        [
          t(diaryConditionKey(weather.code), { code: weather.code }),
          t("diary.temperature_range", {
            min: weather.temperatureMin ?? "–",
            max: weather.temperatureMax ?? "–",
          }),
          ...(weather.precipitation !== null
            ? [t("diary.precipitation", { value: weather.precipitation })]
            : []),
        ].join(" · "),
      );
      text(
        `${t("diary.weather_attribution")} · ${t("diary.weather_license")} · https://open-meteo.com/ · https://creativecommons.org/licenses/by/4.0/`,
        8,
        regular,
        MUTED,
      );
    }
    section(t("diary.work_done"), entry.work_done);
    section(t("diary.progress"), entry.progress);
    section(t("diary.issues"), entry.issues);
    const taskIds = new Set(parseDiaryIds(entry.task_ids));
    const eventIds = new Set(parseDiaryIds(entry.event_ids));
    const tradeIds = new Set(parseDiaryIds(entry.trade_ids));
    section(
      t("diary.tasks"),
      input.workspace.tasks
        .filter((task) => taskIds.has(task.id))
        .map((task) => `• ${task.title}`)
        .join("\n"),
    );
    section(
      t("diary.events"),
      input.workspace.events
        .filter((event) => eventIds.has(event.id))
        .map((event) => `• ${date(event.event_date)} – ${event.title}`)
        .join("\n"),
    );
    section(
      t("diary.trades"),
      input.workspace.trades
        .filter((trade) => tradeIds.has(trade.id))
        .map((trade) => trade.name)
        .join(" · "),
    );
    const offerIds = new Set(parseDiaryIds(entry.offer_ids));
    const paymentIds = new Set(parseDiaryIds(entry.payment_ids));
    section(
      t("diary.offers"),
      input.workspace.offers
        .filter((offer) => offerIds.has(offer.id))
        .map(
          (offer) =>
            `${offer.title || offer.contractor} · ${offer.contractor} · ${money(offer.amount)}${offer.offer_date ? ` · ${t("diary.offer_on", { date: date(offer.offer_date) })}` : ""}`,
        )
        .join("\n"),
    );
    section(
      t("diary.payments"),
      input.workspace.expenses
        .filter((expense) => paymentIds.has(expense.id))
        .map(
          (expense) =>
            `${expense.title}${expense.vendor ? ` · ${expense.vendor}` : ""} · ${money(expense.amount)}${expense.payment_date ? ` · ${t("diary.payment_on", { date: date(expense.payment_date) })}` : ""}`,
        )
        .join("\n"),
    );
    const attachments = input.workspace.diary_media.filter(
      (media) => media.diary_entry_id === entry.id,
    );
    let mediaHeadingPending = true;
    const mediaHeading = (height: number) => {
      ensure(height + (mediaHeadingPending ? 34 : 0));
      if (mediaHeadingPending) {
        y -= 16;
        text(t("diary.media"), 11, bold, ACCENT);
        mediaHeadingPending = false;
      }
    };
    for (const media of attachments) {
      if (!media.mime_type?.startsWith("image/")) {
        mediaHeading(30);
        text(`${t("diary.pdf_video")}: ${media.name}`, 10, regular, MUTED);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await input.photo(media);
      } catch {
        omitted.push(media.name);
        mediaHeading(100);
        section(media.name, t("diary.pdf_photo_unavailable"));
        continue;
      }
      const image = await pdf.embedJpg(bytes);
      const scale = Math.min(WIDTH / image.width, 290 / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const caption = linesFor(media.name, regular, 9, WIDTH);
      mediaHeading(height + caption.length * 14 + 24);
      y -= 8;
      page.drawImage(image, { x: PAGE.margin, y: y - height, width, height });
      y -= height + 16;
      text(media.name, 9, regular, MUTED);
    }
  }
  const pages = pdf.getPages();
  for (const [index, item] of pages.entries()) {
    item.drawLine({
      start: { x: PAGE.margin, y: 44 },
      end: { x: PAGE.width - PAGE.margin, y: 44 },
      color: PALE,
      thickness: 1,
    });
    const footer = t("diary.pdf_page", { page: index + 1, total: pages.length });
    item.drawText(footer, {
      x: PAGE.width - PAGE.margin - regular.widthOfTextAtSize(footer, 8),
      y: 29,
      size: 8,
      font: regular,
      color: MUTED,
    });
    item.drawText(t("diary.title"), {
      x: PAGE.margin,
      y: 29,
      size: 8,
      font: regular,
      color: MUTED,
    });
  }
  return { bytes: await pdf.save(), omitted };
}

async function localFont(name: string) {
  const response = await fetch(`${__PDFJS_ASSET_BASE__}standard_fonts/LiberationSans-${name}.ttf`);
  if (!response.ok) throw new Error("diary.pdf_fonts_unavailable");
  return new Uint8Array(await response.arrayBuffer());
}

async function diaryPhoto(media: DiaryMedia) {
  if (!media.storage_path) throw new Error("diary.pdf_photo_unavailable");
  let blob: Blob;
  if (media.storage_path.startsWith("offline:")) {
    const account = getOfflineAccount();
    const uploads = account ? await listUploads(account.id) : [];
    const upload = uploads.find((item) => item.id === media.storage_path!.slice("offline:".length));
    if (!upload) throw new Error("diary.pdf_photo_unavailable");
    blob = upload.file;
  } else {
    const { url } = await getFileUrl({ data: { path: media.storage_path } });
    const response = await fetch(url);
    if (!response.ok) throw new Error("diary.pdf_photo_unavailable");
    blob = await response.blob();
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("diary.pdf_photo_unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (!jpeg) throw new Error("diary.pdf_photo_unavailable");
    return new Uint8Array(await jpeg.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

export async function downloadDiaryPdf(
  workspace: Workspace,
  project: Project,
  entries: DiaryEntry[],
  language: string,
) {
  const [regular, bold] = await Promise.all([localFont("Regular"), localFont("Bold")]);
  const { bytes, omitted } = await createDiaryPdf({
    workspace,
    project,
    entries,
    language,
    fonts: { regular, bold },
    photo: diaryPhoto,
  });
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${i18n.getFixedT(language, "ui")("diary.pdf_filename")}-${project.name.replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return omitted;
}
