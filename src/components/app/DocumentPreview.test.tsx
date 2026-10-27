import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { DocumentPreview } from "./DocumentPreview";

vi.mock("./PdfReader", () => ({
  default: ({ url }: { url: string }) => <div data-testid="pdf-reader">{url}</div>,
}));
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("DocumentPreview", () => {
  it("expands the same PDF dialog without requiring the Fullscreen API", async () => {
    render(
      <DocumentPreview
        name="Invoice.pdf"
        mime="application/pdf"
        url="/invoice.pdf"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("pdf-reader")).toHaveTextContent("/invoice.pdf");
    const dialog = screen.getByRole("dialog", { name: "Invoice.pdf" });
    expect(dialog).not.toHaveClass("h-dvh");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(dialog).toHaveClass("h-dvh", "max-w-none");
    expect(screen.getByRole("button", { name: "Exit full screen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(dialog).not.toHaveClass("h-dvh");
    expect(screen.getByRole("link", { name: "Open / download original" })).toHaveAttribute(
      "href",
      "/invoice.pdf",
    );
  });

  it("also expands images and preserves the close action", () => {
    const onClose = vi.fn();
    render(<DocumentPreview name="Photo" mime="image/jpeg" url="/photo.jpg" onClose={onClose} />);
    expect(screen.getByRole("img", { name: "Photo" })).toHaveAttribute("src", "/photo.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("dialog")).toHaveClass("h-dvh");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
