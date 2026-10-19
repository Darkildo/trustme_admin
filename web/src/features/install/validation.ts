import { isValidName, parseLabels } from "@/features/nodes/validation";
import type { Backend, ProvisionInput, SshInstallInput } from "@/lib/types";

export const DEFAULT_NODE_PORT = 18081;
export const DEFAULT_SSH_PORT = 22;
/** Ports coturn needs when installed next to the node. */
export const COTURN_PORTS = ["3478/udp", "3478/tcp", "49160–49200/udp"] as const;

function validPort(text: string): boolean {
  if (!/^\d{1,5}$/.test(text.trim())) return false;
  const n = Number(text);
  return n >= 1 && n <= 65535;
}

const HOST_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*\\.?$`);
const IPV6_RE = /^\[?[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*\]?$/;

/** IP address or server name, no port (IPv6 with or without brackets). */
export function isValidHost(host: string): boolean {
  const v = host.trim();
  if (!v || v.length > 253) return false;
  if (v.includes(":")) return IPV6_RE.test(v) && v.startsWith("[") === v.endsWith("]");
  return HOSTNAME_RE.test(v);
}

// ---- «Новая нода» → server form ----

export interface ProvisionFormValues {
  name: string;
  public_host: string;
  port: string;
  backend: Backend;
  with_turn: boolean;
  /** "" — the default profile. */
  profile_id: string;
  turn_server_ids: string[];
  labels: string;
}

export const EMPTY_PROVISION: ProvisionFormValues = {
  name: "",
  public_host: "",
  port: String(DEFAULT_NODE_PORT),
  backend: "sled",
  with_turn: true,
  profile_id: "",
  turn_server_ids: [],
  labels: "",
};

export type ProvisionFormErrors = Partial<
  Record<"name" | "public_host" | "port" | "labels", string>
>;

export function validateProvisionForm(v: ProvisionFormValues): ProvisionFormErrors {
  const e: ProvisionFormErrors = {};
  if (!isValidName(v.name)) e.name = "validation.name";
  if (!isValidHost(v.public_host)) e.public_host = "install.errors.host";
  if (!validPort(v.port)) e.port = "install.errors.port";
  if (!parseLabels(v.labels).ok) e.labels = "validation.labels";
  return e;
}

export function provisionPayload(v: ProvisionFormValues): ProvisionInput {
  const labels = parseLabels(v.labels);
  const out: ProvisionInput = {
    name: v.name.trim(),
    public_host: v.public_host.trim(),
    port: Number(v.port),
    backend: v.backend,
    with_turn: v.with_turn,
  };
  if (v.profile_id) out.profile_id = v.profile_id;
  if (v.turn_server_ids.length > 0) out.turn_server_ids = v.turn_server_ids;
  if (labels.ok && Object.keys(labels.labels).length > 0) out.labels = labels.labels;
  return out;
}

// ---- SSH install ----

export type SshAuth = "password" | "key";

export interface SshFormValues {
  host: string;
  port: string;
  username: string;
  auth: SshAuth;
  password: string;
  private_key: string;
  passphrase: string;
  sudo_password: string;
  host_fingerprint: string;
}

export function emptySshForm(host = ""): SshFormValues {
  return {
    host,
    port: String(DEFAULT_SSH_PORT),
    username: "root",
    auth: "password",
    password: "",
    private_key: "",
    passphrase: "",
    sudo_password: "",
    host_fingerprint: "",
  };
}

export type SshFormErrors = Partial<
  Record<"host" | "port" | "username" | "password" | "private_key" | "host_fingerprint", string>
>;

const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+-----END [A-Z0-9 ]*PRIVATE KEY-----/;
/** OpenSSH prints `SHA256:` + 43 base64 characters (no padding). */
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}=?$/;

export function validateSshForm(v: SshFormValues): SshFormErrors {
  const e: SshFormErrors = {};
  if (!isValidHost(v.host)) e.host = "install.errors.host";
  if (!validPort(v.port)) e.port = "install.errors.port";
  const user = v.username.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) e.username = "install.errors.username";
  if (v.auth === "password") {
    if (!v.password) e.password = "install.errors.password";
  } else if (!PEM_RE.test(v.private_key.trim())) {
    e.private_key = "install.errors.privateKey";
  }
  const fp = v.host_fingerprint.trim();
  if (fp && !FINGERPRINT_RE.test(fp)) e.host_fingerprint = "install.errors.fingerprint";
  return e;
}

/**
 * Request body: only the chosen auth method is sent, empty optional fields are omitted
 * (the server then uses its defaults: sudo password = login password, host = public_host).
 */
export function sshPayload(v: SshFormValues): SshInstallInput {
  const out: SshInstallInput = { username: v.username.trim() };
  if (v.auth === "password") {
    out.password = v.password;
  } else {
    out.private_key = v.private_key.trim() + "\n";
    if (v.passphrase) out.passphrase = v.passphrase;
  }
  if (v.sudo_password) out.sudo_password = v.sudo_password;
  if (v.host.trim()) out.host = v.host.trim();
  const port = Number(v.port);
  if (port !== DEFAULT_SSH_PORT) out.port = port;
  if (v.host_fingerprint.trim()) out.host_fingerprint = v.host_fingerprint.trim();
  return out;
}
