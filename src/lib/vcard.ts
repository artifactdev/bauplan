import type { Contact } from "./schema";

const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

// vCard lines are limited to 75 UTF-8 octets, including continuation whitespace.
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  let result = "";
  let length = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (length + bytes > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += char;
    length += bytes;
  }
  return result;
}

export function contactVCard(contact: Contact): string {
  const name = escapeText(contact.name.trim() || contact.company?.trim() || "");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${name}`,
    // Keep the full name intact rather than guessing family/given names.
    `N:;${name};;;`,
  ];
  if (contact.company?.trim()) lines.push(`ORG:${escapeText(contact.company.trim())}`);
  if (contact.phone?.trim()) lines.push(`TEL;TYPE=VOICE:${escapeText(contact.phone.trim())}`);
  if (contact.email?.trim()) lines.push(`EMAIL;TYPE=INTERNET:${escapeText(contact.email.trim())}`);
  if (contact.website?.trim()) {
    const website = contact.website.trim();
    lines.push(`URL:${escapeText(/^https?:\/\//i.test(website) ? website : `https://${website}`)}`);
  }
  // The app stores an unstructured address; retain it as the street-address component.
  if (contact.address?.trim())
    lines.push(`ADR;TYPE=WORK:;;${escapeText(contact.address.trim())};;;;`);
  if (contact.notes?.trim()) lines.push(`NOTE:${escapeText(contact.notes.trim())}`);
  lines.push("END:VCARD");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function downloadContactVCard(contact: Contact): void {
  const blob = new Blob([contactVCard(contact)], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const name = contact.name.trim() || contact.company?.trim() || "contact";
  link.download = `${name.replace(/[\p{Cc}/\\:*?"<>|]/gu, "_").slice(0, 100)}.vcf`;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
