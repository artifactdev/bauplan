import { useEffect, useRef } from "react";

/** Opens a pushed record once, after its workspace data has loaded. */
export function usePushTarget<T extends { id: string }>(rows: T[], open: (row: T) => void) {
  const consumed = useRef(false);
  const callback = useRef(open);
  callback.current = open;
  useEffect(() => {
    if (consumed.current) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("eintrag");
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    consumed.current = true;
    callback.current(row);
    url.searchParams.delete("eintrag");
    window.history.replaceState(window.history.state, "", url);
  }, [rows]);
}
