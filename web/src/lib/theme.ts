import { useSyncExternalStore } from "react";
import { storage } from "./utils";

export type Theme = "dark" | "light";

const STORAGE_KEY = "tm-admin.theme";
const listeners = new Set<() => void>();

function read(): Theme {
  return storage.get(STORAGE_KEY) === "light" ? "light" : "dark";
}

let current: Theme = read();

export function applyTheme(theme: Theme): void {
  current = theme;
  if (typeof document !== "undefined") {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.setAttribute("data-theme", "dark");
  }
}

export function setTheme(theme: Theme): void {
  storage.set(STORAGE_KEY, theme);
  applyTheme(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme(): void {
  setTheme(current === "dark" ? "light" : "dark");
}

export function getTheme(): Theme {
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
