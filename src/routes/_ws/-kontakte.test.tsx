import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { downloadContactVCard } from "@/lib/vcard";
import { Route } from "./kontakte";

const mocks = vi.hoisted(() => ({
  contacts: [
    { id: "c1", name: "Person One", company: "Company One", phone: "+49 123" },
    { id: "c2", name: "Person Two", company: "Company Two", phone: "+49 456" },
  ],
  toast: vi.fn(),
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({ ws: { contacts: mocks.contacts, offers: [], trades: [] } }),
  useMutations: () => ({ create: {}, update: {}, remove: {} }),
}));
vi.mock("@/lib/vcard", () => ({ downloadContactVCard: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/components/app/EntityDialog", () => ({ EntityDialog: () => null }));

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderContacts() {
  const Page = Route.options.component;
  if (!Page) throw new Error("Missing contacts page");
  render(<Page />);
}

describe("contact phone export", () => {
  it("exports the selected contact without modifying the workspace", () => {
    renderContacts();
    const card = screen.getByText("Company Two").closest("section");
    if (!card) throw new Error("Missing contact card");
    fireEvent.click(within(card).getByRole("button", { name: "Save to phone contacts" }));
    expect(downloadContactVCard).toHaveBeenCalledExactlyOnceWith(mocks.contacts[1]);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("shows a localized error instead of reporting success when export fails", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(downloadContactVCard).mockImplementation(() => {
      throw new Error("blocked");
    });
    renderContacts();
    fireEvent.click(screen.getAllByRole("button", { name: "Save to phone contacts" })[0]!);
    expect(mocks.toast).toHaveBeenCalledWith(
      "The contact could not be exported as a vCard. Please try again.",
    );
    expect(log).toHaveBeenCalled();
  });

  it("provides the German action label", async () => {
    await i18n.changeLanguage("de");
    renderContacts();
    expect(screen.getAllByRole("button", { name: "Im Telefonbuch speichern" })).toHaveLength(2);
  });
});
