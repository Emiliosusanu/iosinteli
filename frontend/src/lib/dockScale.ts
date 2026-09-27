/** Adaptive stadium dock sizing for small / medium / large screens. */

export type DockScale = {
  tier: "sm" | "md" | "lg";
  sideInset: number;
  maxWidth: number;
  railMinHeight: number;
  segmentMinHeight: number;
  icon: number;
  iconActive: number;
  labelSize: number;
  padH: number;
  padV: number;
  useShortLabel: boolean;
  showSelectedLabel: boolean;
};

/** Adaptive stadium dock — taller rail for vertical active pill (icon + label). */
export function dockScaleForWidth(width: number): DockScale {
  if (width < 360) {
    return {
      tier: "sm",
      sideInset: 12,
      maxWidth: 400,
      railMinHeight: 64,
      segmentMinHeight: 52,
      icon: 22,
      iconActive: 22,
      labelSize: 10,
      padH: 5,
      padV: 5,
      useShortLabel: true,
      showSelectedLabel: width >= 320,
    };
  }
  if (width < 430) {
    return {
      tier: "md",
      sideInset: 16,
      maxWidth: 440,
      railMinHeight: 68,
      segmentMinHeight: 56,
      icon: 24,
      iconActive: 24,
      labelSize: 11,
      padH: 6,
      padV: 6,
      useShortLabel: true,
      showSelectedLabel: true,
    };
  }
  return {
    tier: "lg",
    sideInset: width >= 768 ? 28 : 20,
    maxWidth: width >= 768 ? 560 : 480,
    railMinHeight: width >= 768 ? 74 : 70,
    segmentMinHeight: width >= 768 ? 60 : 58,
    icon: width >= 768 ? 26 : 25,
    iconActive: width >= 768 ? 26 : 25,
    labelSize: width >= 768 ? 12 : 11,
    padH: 7,
    padV: 6,
    useShortLabel: true,
    showSelectedLabel: true,
  };
}
