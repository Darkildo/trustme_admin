import type { TFunction } from "i18next";
import { ApiError } from "./api";

/** Human message for any thrown value; server messages are shown for input/conflict errors. */
export function errorMessage(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "invalid_input":
      case "conflict":
      case "unprocessable":
        return t(`errors.${e.code}`, { message: e.message });
      case "rate_limited":
        return e.retryAfter !== null
          ? t("errors.rate_limited_in", { seconds: e.retryAfter })
          : t("errors.rate_limited");
      case "unauthorized":
      case "totp_required":
      case "forbidden":
      case "not_found":
      case "internal":
      case "network":
        return t(`errors.${e.code}`);
      default:
        return e.message || t("errors.generic");
    }
  }
  return t("errors.generic");
}
