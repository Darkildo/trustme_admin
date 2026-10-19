import { createContext, useContext } from "react";
import type { InstallTarget } from "@/features/install/InstallDialog";

export interface UiState {
  openPalette: () => void;
  openAddNode: () => void;
  /** Install command / SSH install for a node that awaits its agent. */
  openInstall: (node: InstallTarget) => void;
}

export const UiContext = createContext<UiState>({
  openPalette: () => {},
  openAddNode: () => {},
  openInstall: () => {},
});

export function useUi(): UiState {
  return useContext(UiContext);
}
