import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { TaskChecklist } from "./TaskChecklist";

beforeEach(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("adds multiple entries with Enter or Add, checks, unchecks and removes them", () => {
  const submit = vi.fn();
  function Form() {
    const [value, setValue] = useState<string>();
    return (
      <form onSubmit={submit}>
        <TaskChecklist value={value} onChange={setValue} />
        <output>{value}</output>
      </form>
    );
  }
  render(<Form />);
  const input = screen.getByRole("textbox", { name: "New subtask" });
  const addButton = screen.getByRole("button", { name: "Add" });
  expect(addButton).toHaveAttribute("title", "Add");
  expect(addButton).toHaveTextContent("");
  expect(addButton).toHaveClass("shrink-0");
  expect(input).toHaveClass("h-11", "min-w-0", "flex-1");
  fireEvent.change(input, { target: { value: "  Measure room  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).not.toHaveBeenCalled();
  expect(input).toHaveValue("");
  expect(screen.getByText("0 of 1 completed")).toBeVisible();
  fireEvent.change(input, { target: { value: "Order tiles" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  const checkbox = screen.getByRole("checkbox", { name: "Measure room" });
  fireEvent.click(checkbox);
  expect(checkbox).toBeChecked();
  expect(screen.getByText("1 of 2 completed")).toBeVisible();
  fireEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Remove subtask: Order tiles" }));
  expect(screen.queryByText("Order tiles")).not.toBeInTheDocument();
  expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual([
    { id: expect.any(String), title: "Measure room", done: false },
  ]);
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
});

it("allows only ticking existing entries in task details", () => {
  const change = vi.fn();
  render(
    <TaskChecklist
      value={JSON.stringify([{ id: "step", title: "Measure room", done: false }])}
      onChange={change}
      editable={false}
    />,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Measure room" }));
  expect(JSON.parse(change.mock.calls[0]![0])).toEqual([
    { id: "step", title: "Measure room", done: true },
  ]);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("does not submit a new entry during composition or accept whitespace-only entries", () => {
  const change = vi.fn();
  render(<TaskChecklist value={null} onChange={change} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Measure" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(change).not.toHaveBeenCalled();
});
