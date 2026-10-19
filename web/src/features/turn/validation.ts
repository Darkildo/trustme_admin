/** Checks for ICE server URLs — the same rules the node applies (api.md «TURN-серверы»). */

export const TURN_SCHEMES = ["stun:", "stuns:", "turn:", "turns:"] as const;
export type TurnScheme = (typeof TURN_SCHEMES)[number];

export const MAX_TURN_URLS = 8;
export const MIN_SECRET_LEN = 16;

export type TurnUrlError = "empty" | "scheme" | "host" | "port" | "transport";

const HOST_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_RE = /^\[[0-9A-Fa-f:.]+\]$/;

export function turnScheme(url: string): TurnScheme | null {
  const lower = url.trim().toLowerCase();
  return TURN_SCHEMES.find((s) => lower.startsWith(s)) ?? null;
}

export function isRelayUrl(url: string): boolean {
  const s = turnScheme(url);
  return s === "turn:" || s === "turns:";
}

/**
 * `stun:host[:port]`, `turn:host[:port][?transport=udp|tcp]`, `turns:…`. IPv6 hosts go in
 * brackets. Returns null when valid, otherwise what is wrong.
 */
export function validateTurnUrl(raw: string): TurnUrlError | null {
  const url = raw.trim();
  if (!url) return "empty";
  const scheme = turnScheme(url);
  if (!scheme) return "scheme";
  let rest = url.slice(scheme.length);
  if (rest.startsWith("//")) return "host";

  const q = rest.indexOf("?");
  if (q >= 0) {
    const query = rest.slice(q + 1);
    rest = rest.slice(0, q);
    if (scheme === "stun:" || scheme === "stuns:") return "transport";
    if (!/^transport=(udp|tcp)$/i.test(query)) return "transport";
  }

  let host = rest;
  let port: string | null = null;
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) return "host";
    host = rest.slice(0, end + 1);
    const after = rest.slice(end + 1);
    if (after) {
      if (!after.startsWith(":")) return "host";
      port = after.slice(1);
    }
  } else {
    const idx = rest.lastIndexOf(":");
    if (idx >= 0) {
      host = rest.slice(0, idx);
      port = rest.slice(idx + 1);
    }
  }
  if (!host || !(IPV6_RE.test(host) || IPV4_RE.test(host) || HOSTNAME_RE.test(host))) {
    return "host";
  }
  if (port !== null) {
    if (!/^\d{1,5}$/.test(port)) return "port";
    const n = Number(port);
    if (n < 1 || n > 65535) return "port";
  }
  return null;
}

/** What happens to the secret on save. */
export type SecretMode = "keep" | "set" | "remove";

export interface TurnFormValues {
  name: string;
  urls: string[];
  secretMode: SecretMode;
  secret: string;
}

export interface TurnFormErrors {
  name?: string;
  /** Per URL row, i18n key. */
  urls?: Array<string | undefined>;
  /** Whole list (count, duplicates, none). */
  list?: string;
  secret?: string;
}

/**
 * Validate the add/edit form. `hadSecret` — the server already stores a secret
 * (`has_secret`), so «keep» means a secret is present.
 */
export function validateTurnForm(v: TurnFormValues, hadSecret: boolean): TurnFormErrors {
  const errors: TurnFormErrors = {};
  const name = v.name.trim();
  if (name.length < 1 || [...name].length > 64) errors.name = "validation.name";

  const urls = v.urls.map((u) => u.trim());
  const filled = urls.filter(Boolean);
  if (filled.length === 0) errors.list = "turn.errors.noUrls";
  else if (filled.length > MAX_TURN_URLS) errors.list = "turn.errors.tooMany";

  const rowErrors = urls.map((u, i) => {
    if (!u) return urls.length > 1 ? undefined : "turn.errors.empty";
    const e = validateTurnUrl(u);
    if (e) return `turn.errors.${e}`;
    if (urls.findIndex((x) => x.toLowerCase() === u.toLowerCase()) !== i)
      return "turn.errors.duplicate";
    return undefined;
  });
  if (rowErrors.some(Boolean)) errors.urls = rowErrors;

  const needsSecret = filled.some(isRelayUrl);
  if (v.secretMode === "set") {
    if (v.secret.length < MIN_SECRET_LEN) errors.secret = "turn.errors.secretShort";
  } else {
    const hasSecret = v.secretMode === "keep" && hadSecret;
    if (needsSecret && !hasSecret) errors.secret = "turn.errors.secretNeeded";
  }
  return errors;
}

export function hasTurnErrors(e: TurnFormErrors): boolean {
  return Boolean(e.name || e.list || e.secret || e.urls?.some(Boolean));
}

/** Body for POST/PATCH: `secret` omitted to keep the old one, "" to remove it. */
export function turnPayload(v: TurnFormValues): { name: string; urls: string[]; secret?: string } {
  const out: { name: string; urls: string[]; secret?: string } = {
    name: v.name.trim(),
    urls: v.urls.map((u) => u.trim()).filter(Boolean),
  };
  if (v.secretMode === "set") out.secret = v.secret;
  if (v.secretMode === "remove") out.secret = "";
  return out;
}

/** 32 URL-safe random characters for a TURN shared secret. */
export function generateSecret(length = 32): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
