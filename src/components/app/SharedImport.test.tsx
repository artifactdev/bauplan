import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { SharedImport } from "./SharedImport";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/share-inbox", () => ({
  listSharedFiles: mocks.list,
  removeSharedFile: mocks.remove,
}));
type ImportProps = {
  open: boolean;
  initialFile?: File;
  initial?: Record<string, unknown>;
  onSaved?: () => void;
  onOpenChange: (open: boolean) => void;
};
function ImportStub({ open, initialFile, initial, onSaved, onOpenChange }: ImportProps) {
  return open ? (
    <div>
      <p>{initialFile?.name}</p>
      <p>{String(initial?.["status"] ?? "document")}</p>
      <button
        onClick={() => {
          onSaved?.();
          onOpenChange(false);
        }}
      >
        save import
      </button>
      <button onClick={() => onOpenChange(false)}>cancel import</button>
    </div>
  ) : null;
}
vi.mock("./OfferDialog", () => ({
  OfferDialog: (props: ImportProps) => <ImportStub {...props} />,
}));
vi.mock("./ExpenseDialog", () => ({
  ExpenseDialog: (props: ImportProps) => <ImportStub {...props} />,
}));
vi.mock("./quick-actions", () => ({
  QuickUpload: (props: ImportProps) => <ImportStub {...props} />,
}));

const first = { key: "first", file: new File(["pdf"], "Quote.pdf", { type: "application/pdf" }) };
const second = {
  key: "second",
  file: new File(["pdf"], "Receipt.pdf", { type: "application/pdf" }),
};
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  mocks.list.mockResolvedValue([first, second]);
  mocks.remove.mockImplementation(async (key: string) => {
    const files = await mocks.list();
    mocks.list.mockResolvedValue(files.filter((file: { key: string }) => file.key !== key));
  });
});
afterEach(cleanup);

describe("shared document classification", () => {
  it.each([
    ["Quote", "received"],
    ["Invoice (open)", "offen"],
    ["Expense / receipt (paid)", "bezahlt"],
    ["General document", "document"],
  ])("opens the existing %s import with the received file", async (label, status) => {
    render(<SharedImport />);
    fireEvent.click(await screen.findByRole("button", { name: label }));
    expect(screen.getByText("Quote.pdf")).toBeInTheDocument();
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("save import"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("first"));
    expect(await screen.findByText("Receipt.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quote" })).toBeInTheDocument();
  });

  it("does not consume the file on cancellation", async () => {
    render(<SharedImport />);
    fireEvent.click(await screen.findByRole("button", { name: "Quote" }));
    fireEvent.click(screen.getByText("cancel import"));
    expect(await screen.findByRole("button", { name: "Quote" })).toBeInTheDocument();
    expect(screen.getByText("Quote.pdf")).toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("allows postponing and explicitly discarding a file", async () => {
    render(<SharedImport />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import shared documents (2)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard file" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("first"));
    expect(await screen.findByText("Receipt.pdf")).toBeInTheDocument();
  });

  it("retries cleanup without allowing a second import after a storage failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.remove.mockRejectedValueOnce(new Error("storage"));
    render(<SharedImport />);
    fireEvent.click(await screen.findByRole("button", { name: "Quote" }));
    fireEvent.click(screen.getByText("save import"));
    expect(await screen.findByRole("alert")).toHaveTextContent("retry cleanup");
    fireEvent.focus(window);
    expect(screen.getByRole("alert")).toHaveTextContent("retry cleanup");
    expect(screen.queryByRole("button", { name: "Quote" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Receipt.pdf")).toBeInTheDocument();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("retains File identity across focus events so automatic OCR is not restarted", async () => {
    render(<SharedImport />);
    fireEvent.click(await screen.findByRole("button", { name: "Quote" }));
    mocks.list.mockResolvedValue([{ ...first, file: new File(["pdf"], "New identity.pdf") }]);
    fireEvent.focus(window);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Quote.pdf")).toBeInTheDocument();
    expect(screen.queryByText("New identity.pdf")).not.toBeInTheDocument();
  });
});
