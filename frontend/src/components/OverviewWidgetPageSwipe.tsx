import React, { createContext, useContext } from "react";
import type { PanGesture } from "react-native-gesture-handler";

/** Chart scrub pans block this so day-inspect doesn't steal widget page changes. */
export const OverviewWidgetPageSwipeContext = createContext<PanGesture | null>(null);

export function useOverviewWidgetPageSwipeGesture(): PanGesture | null {
  return useContext(OverviewWidgetPageSwipeContext);
}
