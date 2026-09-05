/**
 * Day-series X layout for Overview / Ads charts.
 *
 * Stretching 2–5 days across a phone-wide plot creates huge empty gaps.
 * Cap the day-to-day pitch so short windows stay compact (left-aligned);
 * longer windows still fill the plot naturally.
 */

/** Max pixels between consecutive day centers on a compact chart. */
export const CHART_MAX_DAY_STEP_PX = 36;

/** Prefer this pitch when there is room (still never exceeds the stretch fill). */
export const CHART_COMFORTABLE_DAY_STEP_PX = 28;

export type DayXLayout = {
  /** Distance between consecutive day centers. */
  step: number;
  /** Distance from first to last day center (0 when count ≤ 1). */
  span: number;
  /** Absolute x for day index `i` (includes inset). */
  xAt: (index: number) => number;
  /** Map a touch x to a day index. */
  indexAtX: (x: number) => number;
};

export function dayXLayout(count: number, plotWidth: number, inset = 0): DayXLayout {
  const width = Math.max(1, plotWidth);
  if (count <= 0) {
    return {
      step: 0,
      span: 0,
      xAt: () => inset,
      indexAtX: () => 0,
    };
  }
  if (count === 1) {
    // Single day sits near the start — not stranded in the middle of empty space.
    const x = inset + Math.min(CHART_COMFORTABLE_DAY_STEP_PX / 2, width * 0.12);
    return {
      step: 0,
      span: 0,
      xAt: () => x,
      indexAtX: () => 0,
    };
  }

  const stretchStep = width / (count - 1);
  const step = Math.min(stretchStep, CHART_MAX_DAY_STEP_PX);
  const span = step * (count - 1);

  return {
    step,
    span,
    xAt: (index: number) => inset + index * step,
    indexAtX: (x: number) => {
      if (span <= 0) return 0;
      const pct = Math.max(0, Math.min(1, (x - inset) / span));
      return Math.max(0, Math.min(count - 1, Math.round(pct * (count - 1))));
    },
  };
}

/** Bar slot width for categorical day bars — capped so few days stay dense. */
export function dayBarStep(count: number, plotWidth: number): number {
  if (count <= 0) return 0;
  const stretch = Math.max(1, plotWidth) / count;
  return Math.min(stretch, CHART_MAX_DAY_STEP_PX);
}
