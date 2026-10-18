import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@/lib/auth";
import { meQuery } from "@/lib/queries";
import type { Role, User } from "@/lib/types";

/** The signed-in user (guaranteed inside the authenticated layout). */
export function useCurrentUser(): User | null {
  return useQuery(meQuery).data ?? null;
}

export function useCan(min: Role): boolean {
  return roleAtLeast(useCurrentUser()?.role, min);
}
