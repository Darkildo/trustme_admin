export const TOKEN_PLACEHOLDER = "tmi_…";

/**
 * The cron line from api.md («Приём отчётов»), for /etc/cron.d. Cron does not support
 * backslash line continuations, so the copyable command is a single line.
 */
export function buildCronCommand(token: string | null, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return (
    `*/5 * * * * root tmnode doctor --json | curl -fsS -X POST ` +
    `-H "Authorization: Bearer ${token ?? TOKEN_PLACEHOLDER}" -H "Content-Type: application/json" ` +
    `--data-binary @- ${base}/api/v1/ingest/report >/dev/null`
  );
}

export function panelOrigin(): string {
  return typeof window === "undefined" ? "https://admin.example.org" : window.location.origin;
}
