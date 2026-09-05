import React, { createContext, useContext, useMemo } from "react";
import { Gesture, type PanGesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

export const OverviewPeriodSwipeContext = createContext<PanGesture | null>(null);

export function useOverviewPeriodSwipeGesture(): PanGesture | null {
  return useContext(OverviewPeriodSwipeContext);
}

/** Horizontal page swipe on Overview chrome — charts block this via context. */
export function createOverviewPeriodPan(
  onShift: (dir: -1 | 1) => void,
  enabled: boolean,
): PanGesture {
  if (!enabled) return Gesture.Pan().enabled(false);
  return Gesture.Pan()
    .activeOffsetX([-48, 48])
    .failOffsetY([-28, 28])
    .onEnd((event) => {
      if (event.translationX > 50) runOnJS(onShift)(-1);
      else if (event.translationX < -50) runOnJS(onShift)(1);
    });
}

export function OverviewPeriodSwipeProvider({
  gesture,
  children,
}: {
  gesture: PanGesture;
  children: React.ReactNode;
}) {
  const value = useMemo(() => gesture, [gesture]);
  return (
    <OverviewPeriodSwipeContext.Provider value={value}>{children}</OverviewPeriodSwipeContext.Provider>
  );
}
