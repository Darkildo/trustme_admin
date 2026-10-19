import type { BlobReserve, CheckStatus } from "@/lib/types";

/** Проверка tmnode, у которой панель предлагает подобрать резерв диска под файлы. */
export const BLOB_RESERVE_CHECK = "host.blob_reserve";

/** Переменная окружения ноды, которой резерв задают вручную (когда агента нет). */
export const BLOB_RESERVE_ENV = "BLOB_DISK_RESERVE_BYTES";

/**
 * Что показать под предупреждением `host.blob_reserve`:
 * - `none` — ничего (проверка не warn, данных нет, подбирать нечего или нет прав);
 * - `no_agent` — подсказка задать резерв в окружении: без агента панель его не доставит;
 * - `lowered` — панель уже уменьшила резерв, а отчёт ещё с прежним — кнопку не показываем.
 *   `legacy`: в отчёте нет `data.reserve_source` — tmnode до исправления doctor сравнивает
 *   с резервом из окружения контейнера и не видит runtime.toml, предупреждение может
 *   остаться и после применения. Новый tmnode покажет новый резерв в следующем отчёте;
 * - `fix` — кнопка «Подобрать резерв».
 */
export type BlobReserveAction =
  | { kind: "none" }
  | { kind: "no_agent" }
  | { kind: "lowered"; panel: number; reserve: number; legacy: boolean }
  | { kind: "fix"; from: number | null; to: number };

export function blobReserveAction(
  status: CheckStatus,
  r: BlobReserve | undefined,
  canAdmin: boolean,
  checkData?: Record<string, unknown>,
): BlobReserveAction {
  if (status !== "warn" || !r) return { kind: "none" };
  if (!r.managed) return { kind: "no_agent" };
  if (r.panel_bytes !== null && r.reserve_bytes !== null && r.panel_bytes < r.reserve_bytes)
    return {
      kind: "lowered",
      panel: r.panel_bytes,
      reserve: r.reserve_bytes,
      legacy: typeof checkData?.reserve_source !== "string",
    };
  if (r.suggested_bytes === null || !canAdmin) return { kind: "none" };
  return { kind: "fix", from: r.reserve_bytes, to: r.suggested_bytes };
}
