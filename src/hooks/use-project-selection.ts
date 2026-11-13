import { useSyncExternalStore } from "react";

const KEY_PREFIX = "bauplan.active-project.";
const CHANGE_EVENT = "bauplan:active-project-change";

export function getActiveProjectId(userId: string | undefined) {
  if (!userId || typeof localStorage === "undefined") return null;
  return localStorage.getItem(`${KEY_PREFIX}${userId}`);
}

export function setActiveProjectId(userId: string | undefined, projectId: string | null) {
  if (!userId || typeof localStorage === "undefined") return;
  const key = `${KEY_PREFIX}${userId}`;
  if (projectId) localStorage.setItem(key, projectId);
  else localStorage.removeItem(key);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useActiveProjectId(userId: string | undefined) {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener(CHANGE_EVENT, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(CHANGE_EVENT, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => getActiveProjectId(userId),
    () => null,
  );
}
