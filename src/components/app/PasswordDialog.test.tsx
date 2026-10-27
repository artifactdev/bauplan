import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { changeOwnPassword, getOwnPasswordState } from "@/lib/auth.functions";
import { PasswordDialog } from "./PasswordDialog";

vi.mock("@/lib/auth.functions", () => ({
  changeOwnPassword: vi.fn(),
  getOwnPasswordState: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("de");
  vi.mocked(getOwnPasswordState).mockResolvedValue({ hasPassword: true });
  vi.mocked(changeOwnPassword).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PasswordDialog />
    </QueryClientProvider>,
  );
  return client;
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Passwort ändern" }));
  await screen.findByLabelText("Neues Passwort (mind. 8 Zeichen)");
  return screen.getByRole("dialog");
}

function fillPasswords(repeat = "new-password") {
  fireEvent.change(screen.getByLabelText("Neues Passwort (mind. 8 Zeichen)"), {
    target: { value: "new-password" },
  });
  fireEvent.change(screen.getByLabelText("Passwort wiederholen"), { target: { value: repeat } });
}

it("keeps the form hidden until the account action opens it and closes after success", async () => {
  const client = renderDialog();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  expect(screen.queryByLabelText("Aktuelles Passwort")).not.toBeInTheDocument();
  const dialog = await openDialog();
  fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
    target: { value: "old-password" },
  });
  fillPasswords();
  fireEvent.click(within(dialog).getByRole("button", { name: "Passwort ändern" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(changeOwnPassword).toHaveBeenCalledWith({
    data: { current: "old-password", password: "new-password" },
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["own-password"] });
  expect(toast.success).toHaveBeenCalledWith("Passwort geändert");
});

it("clears password fields when cancelling and reopening", async () => {
  renderDialog();
  await openDialog();
  fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
    target: { value: "old-password" },
  });
  fillPasswords();
  fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await openDialog();
  expect(screen.getByLabelText("Aktuelles Passwort")).toHaveValue("");
  expect(screen.getByLabelText("Neues Passwort (mind. 8 Zeichen)")).toHaveValue("");
  expect(screen.getByLabelText("Passwort wiederholen")).toHaveValue("");
  expect(changeOwnPassword).not.toHaveBeenCalled();
});

it("rejects mismatching passwords without closing the modal", async () => {
  renderDialog();
  const dialog = await openDialog();
  fillPasswords("different-password");
  fireEvent.submit(within(dialog).getByLabelText("Passwort wiederholen").closest("form")!);
  expect(changeOwnPassword).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Die Passwörter stimmen nicht überein");
  expect(dialog).toBeInTheDocument();
});

it("allows OIDC-only accounts to set their first local password", async () => {
  vi.mocked(getOwnPasswordState).mockResolvedValue({ hasPassword: false });
  renderDialog();
  const dialog = await openDialog();
  expect(screen.queryByLabelText("Aktuelles Passwort")).not.toBeInTheDocument();
  fillPasswords();
  fireEvent.click(within(dialog).getByRole("button", { name: "Passwort ändern" }));
  await waitFor(() =>
    expect(changeOwnPassword).toHaveBeenCalledWith({
      data: { current: "", password: "new-password" },
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("keeps the form open and reports a failed change", async () => {
  vi.mocked(changeOwnPassword).mockRejectedValue(new Error("settings.current_password_wrong"));
  renderDialog();
  const dialog = await openDialog();
  fillPasswords();
  fireEvent.submit(within(dialog).getByLabelText("Passwort wiederholen").closest("form")!);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Das aktuelle Passwort ist falsch."),
  );
  expect(dialog).toBeInTheDocument();
});

it("reports a password-state loading failure instead of displaying an invalid form", async () => {
  vi.mocked(getOwnPasswordState).mockRejectedValue(new Error("Network error"));
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Passwort ändern" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Der Passwortstatus konnte nicht geladen werden.",
  );
  expect(screen.queryByLabelText("Neues Passwort (mind. 8 Zeichen)")).not.toBeInTheDocument();
});
