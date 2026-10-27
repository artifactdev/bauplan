import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePushTarget } from "./use-push-target";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});
it("waits for workspace data and opens the targeted record once", () => {
  window.history.replaceState({}, "", "/aufgaben?eintrag=task");
  const open = vi.fn();
  const { rerender } = renderHook(({ rows }) => usePushTarget(rows, open), {
    initialProps: { rows: [] as { id: string }[] },
  });
  expect(open).not.toHaveBeenCalled();
  rerender({ rows: [{ id: "task" }] });
  expect(open).toHaveBeenCalledWith({ id: "task" });
  expect(window.location.search).toBe("");
  rerender({ rows: [{ id: "task" }] });
  expect(open).toHaveBeenCalledOnce();
});
