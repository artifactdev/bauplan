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
  await visit(page, "/ausgaben", "expenses");
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

  if (!only.length || only.includes("mobile-calendar")) {
    await phone.goto(`${BASE_URL}/kalender`);
    await settle(phone, 1200);
    await shot(phone, "mobile-calendar");
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
