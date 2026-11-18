#!/usr/bin/env node
// Captures the website screenshots from a running Bauplan instance.
//
//   npm run demo            # in one terminal (seeds .demo/ and starts the dev server)
//   npm run site:screenshots
//
// Environment:
//   BASE_URL       default http://localhost:3000
//   DEMO_EMAIL     default demo@bauplan.example
//   DEMO_PASSWORD  default bauplan-demo-2026
//   SHOTS          comma-separated list of shot names to capture (default: all)
//
// Images are written to site/screenshots/ and are committed to the repository.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.DEMO_EMAIL ?? "demo@bauplan.example";
const PASSWORD = process.env.DEMO_PASSWORD ?? "bauplan-demo-2026";
const OUT = path.resolve("site/screenshots");
const only = (process.env.SHOTS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Settles the app: fonts, network and chart animations. */
async function settle(page, delay = 700) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(delay);
}

async function signIn(page) {
  await page.goto(`${BASE_URL}/auth`);
  await settle(page, 200);
  await page.fill("#email", EMAIL);
  await page.fill("#pw", PASSWORD);
  await page.click('form.auth-form button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 20_000 });
  await settle(page, 1000);
}

async function shot(page, name, options = {}) {
  if (only.length && !only.includes(name)) return;
  await page.screenshot({
    path: path.join(OUT, `${name}.jpg`),
    type: "jpeg",
    quality: 88,
    animations: "disabled",
    ...options,
  });
  console.log(`captured ${name}.jpg`);
}

async function visit(page, route, name) {
  await page.goto(`${BASE_URL}${route}`);
  await settle(page);
  await shot(page, name);
}

async function openReportFromSummary(page, title) {
  const report = page.locator("article").filter({
    has: page.getByRole("button", { name: title, exact: true }),
  });
  await report.locator("p.line-clamp-2").click();
  await page.getByRole("dialog", { name: title, exact: true }).waitFor();
}

const browser = await chromium.launch();
try {
  const desktop = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    colorScheme: "light",
  });
  await desktop.addInitScript(() => {
    try {
      localStorage.setItem("bauplan.lang", "de");
    } catch {
      // Storage is unavailable before the first navigation in some browsers.
    }
  });

  const page = await desktop.newPage();
  await signIn(page);

  await visit(page, "/", "overview");
  await visit(page, "/budget", "budget");
  await visit(page, "/angebote", "quotes");
  if (!only.length || only.includes("expenses")) {
    await page.goto(`${BASE_URL}/ausgaben`);
    await settle(page);
    await page
      .getByRole("checkbox", { name: "Ausgabe auswählen: Abschlagsrechnung Sanitär" })
      .first()
      .check();
    await shot(page, "expenses");
  }
  await visit(page, "/dokumente", "documents");

  if (!only.length || only.includes("document-viewer")) {
    await page.goto(`${BASE_URL}/dokumente`);
    await settle(page);
    await page.getByRole("button", { name: "Vorschau" }).first().click();
    await page.waitForSelector('[role="dialog"] canvas', { timeout: 20_000 });
    await page.waitForTimeout(1500);
    await shot(page, "document-viewer", { animations: "allow" });
    await page.keyboard.press("Escape");
  }

  await visit(page, "/aufgaben", "tasks");
  await visit(page, "/tagebuch", "diary");
  if (!only.length || only.includes("diary-navigation")) {
    await page.goto(`${BASE_URL}/tagebuch`);
    await settle(page);
    await page.getByRole("slider", { name: "Zeitnavigation" }).focus();
    await page.keyboard.press("End");
    await settle(page);
    await page.getByRole("button", { name: "Zu Datum springen", exact: true }).click();
    await settle(page);
    await shot(page, "diary-navigation");
  }
  if (!only.length || only.includes("diary-editor")) {
    await page.goto(`${BASE_URL}/tagebuch`);
    await settle(page);
    await page.getByRole("button", { name: "Neuer Eintrag", exact: true }).click();
    await page.getByLabel("Titel", { exact: true }).fill("Leitungswege und Tagesfortschritt");
    await page
      .getByLabel("Ausgeführte Arbeiten", { exact: true })
      .fill("Leitungswege im Erdgeschoss geprüft und mit der Ausführungsplanung abgeglichen.");
    await settle(page);
    await shot(page, "diary-editor");
    await page.getByRole("button", { name: "Formular schließen", exact: true }).click();
  }
  if (!only.length || only.includes("diary-details")) {
    await page.goto(`${BASE_URL}/tagebuch`);
    await settle(page);
    await openReportFromSummary(page, "Rohinstallation dokumentiert");
    await settle(page);
    await shot(page, "diary-details");
  }
  if (!only.length || only.includes("diary-subtasks")) {
    await page.goto(`${BASE_URL}/tagebuch`);
    await settle(page);
    await page.getByRole("button", { name: "Neuer Eintrag", exact: true }).click();
    await page.getByLabel("Titel", { exact: true }).fill("Tagesfortschritt mit Unteraufgaben");
    await page
      .locator("summary")
      .filter({ hasText: /^Unteraufgaben/ })
      .click();
    await page.locator("#diary-subtask-links-search").fill("Elektro-Rohinstallation");
    await page
      .locator("details")
      .filter({ has: page.locator("#diary-subtask-links-search") })
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
    await settle(page);
    await shot(page, "diary-subtasks");
    await page.getByRole("button", { name: "Formular schließen", exact: true }).click();
  }
  if (!only.length || only.includes("diary-photos")) {
    await page.goto(`${BASE_URL}/tagebuch`);
    await settle(page);
    await openReportFromSummary(page, "Rohinstallation dokumentiert");
    await page
      .getByRole("button", { name: "Bild groß anzeigen: Dosenpositionen-Kueche.png" })
      .click();
    await settle(page);
    await shot(page, "diary-photos");
    await page.keyboard.press("Escape");
  }
  if (!only.length || only.includes("diary-wizard")) {
    await page.goto(`${BASE_URL}/tagebuch`);
    await settle(page);
    await page.getByRole("button", { name: "Neuer Eintrag", exact: true }).click();
    const title = "Demo: Tagesbericht in zwei Schritten";
    await page.getByLabel("Titel", { exact: true }).fill(title);
    await page
      .getByLabel("Ausgeführte Arbeiten", { exact: true })
      .fill("Leitungswege geprüft und den Fortschritt im Erdgeschoss dokumentiert.");
    await page.getByRole("button", { name: "Speichern und weiter zu Fotos" }).click();
    await page.getByRole("button", { name: "Ohne Medien abschließen" }).waitFor();
    try {
      await settle(page);
      await page
        .getByText("Bautagebucheintrag gespeichert.", { exact: true })
        .waitFor({ state: "hidden" });
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, "diary-wizard");
    } finally {
      await page.getByRole("button", { name: "Ohne Medien abschließen" }).click();
      const report = page.locator("article").filter({
        has: page.getByRole("heading", { name: title, exact: true }),
      });
      await report.getByRole("button", { name: `Aktionen für ${title}`, exact: true }).click();
      await page.getByRole("menuitem", { name: "Eintrag löschen", exact: true }).click();
      await page
        .getByRole("alertdialog", { name: "Eintrag löschen?", exact: true })
        .getByRole("button", { name: "Löschen", exact: true })
        .click();
      await report.waitFor({ state: "detached" });
    }
  }
  if (!only.length || only.includes("tasks-subtasks")) {
    await page.goto(`${BASE_URL}/aufgaben`);
    await settle(page);
    await page
      .getByRole("button", { name: /Unteraufgaben offen/ })
      .first()
      .click();
    await settle(page, 600);
    await shot(page, "tasks-subtasks");
  }
  await visit(page, "/kalender", "calendar");
  if (!only.length || only.includes("calendar-timeline")) {
    await page.goto(`${BASE_URL}/kalender`);
    await settle(page);
    await page.getByRole("tab", { name: "Bauablauf" }).click();
    await page
      .getByRole("button", { name: "Verknüpfungen anzeigen: Demo: Leitungsverläufe fotografieren" })
      .click();
    await page.getByRole("region", { name: "Bauablauf" }).evaluate((element) => {
      element.scrollTop = 0;
    });
    await settle(page, 800);
    await shot(page, "calendar-timeline");
  }
  if (!only.length || only.includes("calendar-week")) {
    await page.goto(`${BASE_URL}/kalender`);
    await settle(page);
    await page.getByRole("tab", { name: "Woche" }).click();
    await page.getByRole("button", { name: "Nächster Zeitraum" }).click();
    await settle(page, 800);
    await page
      .getByRole("region", { name: "Woche" })
      .evaluate((element) => (element.scrollTop = 7.5 * 96));
    await settle(page, 500);
    await shot(page, "calendar-week");
  }
  await visit(page, "/sammlungen", "collections");
  await visit(page, "/kontakte", "contacts");
  await visit(page, "/analyse", "analysis");
  await visit(page, "/kredit", "loan");
  await visit(page, "/einstellungen", "settings");

  if (!only.length || only.includes("overview-dark")) {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${BASE_URL}/`);
    await settle(page);
    await shot(page, "overview-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }

  const state = await desktop.storageState();
  const mobile = await browser.newContext({
    storageState: state,
    viewport: MOBILE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  });
  const phone = await mobile.newPage();
  await phone.goto(`${BASE_URL}/`);
  await settle(phone, 1200);
  await shot(phone, "mobile-overview");
  if (!only.length || only.includes("mobile-diary")) {
    await phone.goto(`${BASE_URL}/tagebuch`);
    await settle(phone);
    await shot(phone, "mobile-diary");
  }
  if (!only.length || only.includes("mobile-diary-details")) {
    await phone.goto(`${BASE_URL}/tagebuch`);
    await settle(phone);
    await openReportFromSummary(phone, "Rohinstallation dokumentiert");
    await settle(phone);
    await shot(phone, "mobile-diary-details");
  }

  if (!only.length || only.includes("mobile-calendar")) {
    await phone.goto(`${BASE_URL}/kalender`);
    await settle(phone, 1200);
    await shot(phone, "mobile-calendar");
  }
  if (!only.length || only.includes("mobile-calendar-timeline")) {
    await phone.goto(`${BASE_URL}/kalender`);
    await settle(phone);
    await phone.getByRole("tab", { name: "Bauablauf" }).click();
    await settle(phone, 800);
    await shot(phone, "mobile-calendar-timeline");
  }
  await mobile.close();

  const anonymous = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    colorScheme: "light",
  });
  await anonymous.addInitScript(() => {
    try {
      localStorage.setItem("bauplan.lang", "de");
    } catch {
      // Ignore storage restrictions.
    }
  });
  const login = await anonymous.newPage();
  await login.goto(`${BASE_URL}/auth`);
  await settle(login, 800);
  await shot(login, "login");
  await anonymous.close();

  await desktop.close();
} finally {
  await browser.close();
}
