import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { storage } from "@/src/utils/storage";
import {
  QA_COMMAND_KEY,
  dateRangeForQaCommand,
  parseQaCommand,
  stashPendingQaFilters,
  type QaCommand,
} from "@/src/lib/qaCommand";

function shiftRange(range: { start: string; end: string; label?: string }, shift: number, mode: "month" | "week") {
  const parse = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (mode === "month") {
    const start = parse(range.start);
    start.setMonth(start.getMonth() + shift, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const today = new Date();
    const clamped =
      end > today ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : end;
    const label = start.toLocaleString("en-US", { month: "long", year: "numeric" });
    return { start: ymd(start), end: ymd(clamped), label };
  }
  const end = parse(range.end);
  end.setDate(end.getDate() + shift * 7);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { start: ymd(start), end: ymd(end), label: "Last 7 days" };
}

/** One-shot AsyncStorage QA driver for physical filter/date harnesses. */
export function QaBootstrap() {
  const { state } = useAuth();
  const { setDateRange, dateRange } = useApp();
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (state !== "authenticated" || ran.current) return;
    ran.current = true;
    let cancelled = false;

    void (async () => {
      const raw = await storage.getItem(QA_COMMAND_KEY, null);
      const cmd = parseQaCommand(raw);
      if (!cmd || cancelled) return;
      await storage.removeItem(QA_COMMAND_KEY);

      const base = dateRangeForQaCommand(cmd) ?? dateRange;
      const mode = cmd.periodMode ?? (cmd.dateLabel === "Last 7 days" ? "week" : "month");
      const next =
        typeof cmd.periodShift === "number" && cmd.periodShift !== 0
          ? shiftRange(base, cmd.periodShift, mode)
          : base;
      setDateRange(next);

      const filterSeed: QaCommand = {
        id: cmd.id,
        campaignsState: cmd.campaignsState,
        campaignsSort: cmd.campaignsSort,
        targetsSegment: cmd.targetsSegment,
        targetsPerf: cmd.targetsPerf,
        targetsSort: cmd.targetsSort,
        booksSort: cmd.booksSort,
      };
      stashPendingQaFilters(filterSeed);

      if (cmd.route) {
        router.replace(cmd.route as any);
      }

      console.log(
        `[inteliads:qa] applied id=${cmd.id ?? "none"} route=${cmd.route ?? "-"} date=${next.label ?? next.start}..${next.end} shift=${cmd.periodShift ?? 0}`,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [state, router, setDateRange, dateRange]);

  return null;
}
