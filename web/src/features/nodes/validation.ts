const HOST_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*\\.?$`);
const IPV6_RE = /^\[([0-9A-Fa-f:.]+(?:%[A-Za-z0-9]+)?)\]:(\d{1,5})$/;

function validPort(port: string): boolean {
  if (!/^\d{1,5}$/.test(port)) return false;
  const n = Number(port);
  return n >= 1 && n <= 65535;
}

/** `host:port`, `1.2.3.4:port` or `[::1]:port`. */
export function isValidAddr(addr: string): boolean {
  const v = addr.trim();
  if (v !== addr || v.length === 0 || v.length > 261) return false;
  const v6 = IPV6_RE.exec(v);
  if (v6) return v6[1]!.includes(":") && validPort(v6[2]!);
  const idx = v.lastIndexOf(":");
  if (idx <= 0) return false;
  const host = v.slice(0, idx);
  const port = v.slice(idx + 1);
  if (host.includes(":")) return false;
  return HOSTNAME_RE.test(host) && host.length <= 253 && validPort(port);
}

export function isValidNodeKey(key: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(key);
}

export function normalizeNodeKey(key: string): string {
  return key.replace(/\s+/g, "").toLowerCase();
}

export function isValidName(name: string): boolean {
  const len = [...name.trim()].length;
  return len >= 1 && len <= 64;
}

export function isValidInterval(secs: number): boolean {
  return Number.isInteger(secs) && secs >= 15 && secs <= 3600;
}

export type LabelsParse = { ok: true; labels: Record<string, string> } | { ok: false };

/** "env=prod, region=eu" → { env: "prod", region: "eu" }. Empty input → {}. */
export function parseLabels(input: string): LabelsParse {
  const labels: Record<string, string> = {};
  const parts = input
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) return { ok: false };
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!/^[A-Za-z0-9_.\-/]{1,64}$/.test(key) || value.length > 128) return { ok: false };
    labels[key] = value;
  }
  return { ok: true, labels };
}

export function formatLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

export interface NodeFormValues {
  name: string;
  addr: string;
  node_key: string;
  labels: string;
}

export type NodeFormErrors = Partial<Record<keyof NodeFormValues, string>>;

/** Returns i18n keys of errors per field; empty object when valid. */
export function validateNodeForm(v: NodeFormValues): NodeFormErrors {
  const errors: NodeFormErrors = {};
  if (!isValidName(v.name)) errors.name = "validation.name";
  if (!isValidAddr(v.addr.trim())) errors.addr = "validation.addr";
  if (!isValidNodeKey(normalizeNodeKey(v.node_key))) errors.node_key = "validation.nodeKey";
  if (!parseLabels(v.labels).ok) errors.labels = "validation.labels";
  return errors;
}
