import type { Role } from "./types";

const RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

export function roleAtLeast(role: Role | undefined | null, min: Role): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

/** Accept only same-origin relative paths for post-login redirects. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/login") || next.startsWith("/setup") || next.startsWith("/invite"))
    return "/";
  return next;
}
