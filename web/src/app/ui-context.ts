import { createContext, useContext } from "react";

export interface UiState {
  openPalette: () => void;
  openAddNode: () => void;
}

export const UiContext = createContext<UiState>({
  openPalette: () => {},
  openAddNode: () => {},
});

export function useUi(): UiState {
  return useContext(UiContext);
}
