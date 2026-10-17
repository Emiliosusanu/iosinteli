import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { presetRangeFromLabel } from "../lib/format";
import type { DateRange } from "../lib/types";

/** One local-midnight wake while active; background time is handled on resume. */
export function useDateRangeRollover(range: DateRange, ready: boolean, onChange: (range: DateRange) => void) {
  const latest = useRef({ range, onChange });
  latest.current = { range, onChange };

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (disposed || AppState.currentState !== "active") return;
      const now = new Date();
      const current = latest.current;
      const next = presetRangeFromLabel(current.range.label, now);
      if (next && (next.start !== current.range.start || next.end !== current.range.end)) {
        latest.current = { ...current, range: next };
        current.onChange(next);
      }
      if (!next || disposed) return;
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(schedule, Math.max(1, midnight.getTime() - now.getTime()));
    };

    const subscription = AppState.addEventListener("change", schedule);
    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
  }, [ready, range.label]);
}
