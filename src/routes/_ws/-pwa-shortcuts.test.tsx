import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { todayISO } from "@/lib/format";
import { Route as CalendarRoute } from "./kalender";
import { Route as TasksRoute } from "./aufgaben";
import { Route as DocumentsRoute } from "./dokumente";
import { Route as ExpensesRoute } from "./ausgaben";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      events: [],
      tasks: [],
      offers: [],
      trades: [],
      documents: [],
      cost_items: [],
      expenses: [],
      contacts: [],
      budget_pots: [],
    },
  }),
  useMutations: () => ({
    create: { mutate: vi.fn(), mutateAsync: vi.fn() },
    update: { mutate: vi.fn(), mutateAsync: vi.fn() },
    remove: { mutate: vi.fn(), mutateAsync: vi.fn() },
    upload: { mutate: vi.fn(), mutateAsync: vi.fn() },
  }),
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useTaskAssignees: () => ({ data: [], isError: false }),
}));
vi.mock("@/hooks/use-paperless", () => ({
  usePaperlessSettings: () => ({ data: { enabled: false }, error: null }),
  usePaperlessDocuments: () => ({ data: [], error: null }),
}));
vi.mock("@/components/app/DocumentScanner", () => ({
  DocumentScanner: ({ open }: { open: boolean }) => (
    <div data-testid="document-scanner" data-open={open} />
  ),
}));
vi.mock("@/components/app/AssignDialog", () => ({
  AssignDialog: () => null,
}));

beforeEach(async () => {
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

function renderRoute(route: { options: { component?: React.ComponentType } }) {
  const Page = route.options.component;
  if (!Page) throw new Error("Missing route component");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
}

describe("PWA shortcut targets", () => {
  it("launches a new appointment with today's date", () => {
    window.history.replaceState(null, "", "/kalender?aktion=neu");
    renderRoute(CalendarRoute);

    expect(screen.getByRole("dialog", { name: "New appointment" })).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toHaveValue(todayISO());
  });

  it("opens the new-task dialog", () => {
    window.history.replaceState(null, "", "/aufgaben?aktion=neu");
    renderRoute(TasksRoute);

    expect(screen.getByRole("dialog", { name: "New task" })).toBeInTheDocument();
  });

  it("opens the document scanner", () => {
    window.history.replaceState(null, "", "/dokumente?aktion=neu");
    renderRoute(DocumentsRoute);

    expect(
      screen
        .getAllByTestId("document-scanner")
        .some((scanner) => scanner.dataset["open"] === "true"),
    ).toBe(true);
  });

  it("opens the new-expense dialog", () => {
    window.history.replaceState(null, "", "/ausgaben?aktion=neu");
    renderRoute(ExpensesRoute);

    expect(screen.getByRole("dialog", { name: "New expense" })).toBeInTheDocument();
  });
});
