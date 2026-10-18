import { useSyncExternalStore } from "react";

type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  open: boolean;
}

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function push(kind: ToastKind, title: string, description?: string) {
  items = [...items.slice(-4), { id: ++seq, kind, title, description, open: true }];
  emit();
}

export function closeToast(id: number) {
  items = items.map((t) => (t.id === id ? { ...t, open: false } : t));
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 300);
}

export const toast = {
  success: (title: string, description?: string) => push("success", title, description),
  error: (title: string, description?: string) => push("error", title, description),
  info: (title: string, description?: string) => push("info", title, description),
};

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
}
