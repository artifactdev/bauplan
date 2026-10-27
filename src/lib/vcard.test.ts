import { afterEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "./schema";
import { contactVCard, downloadContactVCard } from "./vcard";

const contact: Contact = {
  id: "contact-1",
  name: "Jörg Müller",
  company: "Müller & Söhne",
  trade_id: null,
  phone: "+49 123 456",
  email: "joerg@example.invalid",
  website: "example.invalid",
  address: "Hauptstraße 1\n12345 Berlin",
  notes: "Termin nach Absprache",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("contact vCard", () => {
  it("exports all available contact details with CRLF endings and Unicode intact", () => {
    expect(contactVCard(contact)).toBe(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Jörg Müller",
        "N:;Jörg Müller;;;",
        "ORG:Müller & Söhne",
        "TEL;TYPE=VOICE:+49 123 456",
        "EMAIL;TYPE=INTERNET:joerg@example.invalid",
        "URL:https://example.invalid",
        "ADR;TYPE=WORK:;;Hauptstraße 1\\n12345 Berlin;;;;",
        "NOTE:Termin nach Absprache",
        "END:VCARD",
        "",
      ].join("\r\n"),
    );
  });

  it("escapes separators, backslashes and newline variants without injecting properties", () => {
    const result = contactVCard({
      ...contact,
      name: "Name;Suffix, Extra",
      notes: "Back\\slash\r\nEND:VCARD\rTEL:injected\nLast",
    });
    expect(result).toContain("FN:Name\\;Suffix\\, Extra\r\n");
    expect(result).toContain("NOTE:Back\\\\slash\\nEND:VCARD\\nTEL:injected\\nLast\r\n");
    expect(result.match(/^END:VCARD$/gm)).toHaveLength(1);
    expect(result).not.toContain("\r\nTEL:injected");
  });

  it("folds every physical line at 75 UTF-8 bytes without breaking Unicode", () => {
    const notes = "Ä🙂文字".repeat(50);
    const result = contactVCard({ ...contact, notes });
    for (const line of result.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(result.replace(/\r\n /g, "")).toContain(`NOTE:${notes}\r\n`);
    expect(result).not.toContain("\ufffd");
  });

  it("omits missing optional fields and falls back to the company for a blank person name", () => {
    const result = contactVCard({
      ...contact,
      name: " ",
      phone: null,
      email: "",
      website: null,
      address: null,
      notes: " ",
    });
    expect(result).toContain("FN:Müller & Söhne\r\n");
    expect(result).not.toMatch(/^(TEL|EMAIL|URL|ADR|NOTE)[;:]/m);
  });

  it("preserves an existing HTTPS URL", () => {
    expect(contactVCard({ ...contact, website: "https://example.invalid/path" })).toContain(
      "URL:https://example.invalid/path\r\n",
    );
  });

  it("downloads a vcf using a safe filename and releases the temporary URL", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => "blob:contact");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let download: { href: string; name: string; attached: boolean } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      download = { href: this.href, name: this.download, attached: this.isConnected };
    });
    downloadContactVCard({ ...contact, name: "Jörg / Müller: Firma" });
    expect(download).toEqual({
      href: "blob:contact",
      name: "Jörg _ Müller_ Firma.vcf",
      attached: true,
    });
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob?.type).toBe("text/vcard;charset=utf-8");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:contact");
  });

  it("surfaces export failures and cleans up the temporary link", () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:contact"), revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => downloadContactVCard(contact)).toThrow("blocked");
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:contact");
  });
});
