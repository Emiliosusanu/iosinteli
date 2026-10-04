import { useEffect, useMemo, useState } from "react";
import { fillMissingProductTargetTitlesFromRetail } from "./queries";
import { isUsableBookTitle } from "./targeting";
import type { ProductTarget } from "./types";

/**
 * Fill competitor-ASIN titles after the ranked list has painted.
 *
 * The exact-period RPC deliberately keeps retail HTML off its critical path.
 * Campaign and ad-group details can therefore render metrics immediately, then
 * resolve only their bounded visible rows in small waves. Titles never affect
 * entity identity, order, totals, or Amazon mutations.
 */
export function useVisibleProductTargetTitles<T extends ProductTarget>(
  rows: T[],
  scopeKey: string,
): T[] {
  const [titleById, setTitleById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setTitleById({});

    void (async () => {
      const working = rows.map((row) => ({ ...row }));
      const chunkSize = 40;
      for (let offset = 0; offset < working.length; offset += chunkSize) {
        if (cancelled || controller.signal.aborted) return;
        const slice = working.slice(offset, offset + chunkSize);
        const result = await fillMissingProductTargetTitlesFromRetail(slice, {
          signal: controller.signal,
          maxAsins: chunkSize,
        }).catch(() => ({ rows: slice, filled: 0 }));
        if (cancelled || controller.signal.aborted) return;

        const patch: Record<string, string> = {};
        for (const row of result.rows) {
          if (!row.id || !isUsableBookTitle(row.title)) continue;
          patch[String(row.id)] = String(row.title).trim();
        }
        if (Object.keys(patch).length) {
          setTitleById((previous) => ({ ...previous, ...patch }));
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // scopeKey changes whenever the exact period/catalog changes. `rows` is
    // intentionally captured from that snapshot so title patches cannot leak
    // into another campaign, ad group, profile scope, or date window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  return useMemo(
    () =>
      rows.map((row) => {
        const title = titleById[String(row.id ?? "")];
        return title && !isUsableBookTitle(row.title) ? ({ ...row, title } as T) : row;
      }),
    [rows, titleById],
  );
}
