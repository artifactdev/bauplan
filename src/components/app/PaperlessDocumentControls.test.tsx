import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { PaperlessDocumentControls, PaperlessDocumentStatus } from "./PaperlessDocumentControls";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("document presence and bulk controls", () => {
  it("allows administrators to abandon orphan tracking without using the deleted user's credentials", () => {
    const abandon = vi.fn();
    render(
      <PaperlessDocumentStatus
        linked={false}
        state="paused"
        url={null}
        checked={null}
        verification={null}
        canResolve={false}
        canAbandon
        onResolve={vi.fn()}
        onAbandon={abandon}
      />,
    );
    expect(screen.queryByRole("button", { name: "Resolve transfer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abandon tracking" }));
    expect(abandon).toHaveBeenCalledOnce();
  });

  it("offers both known-presence filters even when the member has not connected", () => {
    const presence = vi.fn();
    render(
      <PaperlessDocumentControls
        connected={false}
        presence="all"
        onPresence={presence}
        selectedCount={0}
        allSelected={false}
        onSelectAll={vi.fn()}
        onClear={vi.fn()}
        onImport={vi.fn()}
        onExport={vi.fn()}
        onVerify={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByRole("option", { name: "Present in Paperless" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Not present in Paperless" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Paperless status"), { target: { value: "absent" } });
    expect(presence).toHaveBeenCalledWith("absent");
    expect(screen.getByRole("button", { name: "Import from Paperless" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Transfer to Paperless" })).toBeDisabled();
  });

  it("retains a known link while displaying the current user's inaccessible state", () => {
    render(
      <PaperlessDocumentStatus
        linked
        state={null}
        url="https://paperless.example.test/documents/8/"
        checked="2026-10-28"
        verification="inaccessible"
        canResolve={false}
        onResolve={vi.fn()}
        onAbandon={vi.fn()}
      />,
    );
    expect(screen.getByText("Linked to Paperless")).toBeInTheDocument();
    expect(screen.getByText("Not accessible to your account; link retained")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Paperless" })).toHaveAttribute(
      "href",
      "https://paperless.example.test/documents/8/",
    );
    expect(screen.queryByRole("button", { name: "Resolve transfer" })).not.toBeInTheDocument();
  });
});
