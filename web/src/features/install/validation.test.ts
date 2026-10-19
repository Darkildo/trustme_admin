import { describe, expect, it } from "vitest";
import {
  EMPTY_PROVISION,
  emptySshForm,
  isValidHost,
  provisionPayload,
  sshPayload,
  validateProvisionForm,
  validateSshForm,
} from "./validation";

const KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----";

describe("SSH install form", () => {
  it("needs a password when signing in with a password", () => {
    const v = { ...emptySshForm("203.0.113.10"), auth: "password" as const };
    expect(validateSshForm(v)).toEqual({ password: "install.errors.password" });
    expect(validateSshForm({ ...v, password: "hunter2" })).toEqual({});
  });

  it("needs an OpenSSH private key when signing in with a key", () => {
    const v = { ...emptySshForm("203.0.113.10"), auth: "key" as const, password: "ignored" };
    expect(validateSshForm(v)).toEqual({ private_key: "install.errors.privateKey" });
    expect(validateSshForm({ ...v, private_key: "ssh-ed25519 AAAA… public key" }).private_key).toBe(
      "install.errors.privateKey",
    );
    expect(validateSshForm({ ...v, private_key: KEY })).toEqual({});
  });

  it("checks host, port, user and the optional fingerprint", () => {
    const v = { ...emptySshForm(""), password: "x" };
    expect(validateSshForm({ ...v, username: "ro ot", port: "0" })).toEqual({
      host: "install.errors.host",
      port: "install.errors.port",
      username: "install.errors.username",
    });
    const ok = { ...v, host: "node.example.org" };
    expect(validateSshForm({ ...ok, host_fingerprint: "MD5:aa" }).host_fingerprint).toBe(
      "install.errors.fingerprint",
    );
    expect(
      validateSshForm({
        ...ok,
        host_fingerprint: "SHA256:" + "A".repeat(43),
      }),
    ).toEqual({});
  });

  it("sends only the chosen auth method and non-empty options", () => {
    const base = { ...emptySshForm("203.0.113.10"), username: " admin " };
    expect(sshPayload({ ...base, password: "pw", private_key: KEY })).toEqual({
      username: "admin",
      password: "pw",
      host: "203.0.113.10",
    });
    expect(
      sshPayload({
        ...base,
        auth: "key",
        password: "pw",
        private_key: KEY,
        passphrase: "pp",
        sudo_password: "sudo",
        port: "2222",
      }),
    ).toEqual({
      username: "admin",
      private_key: KEY + "\n",
      passphrase: "pp",
      sudo_password: "sudo",
      host: "203.0.113.10",
      port: 2222,
    });
  });
});

describe("new server form", () => {
  it("validates name, host and port", () => {
    expect(validateProvisionForm(EMPTY_PROVISION)).toEqual({
      name: "validation.name",
      public_host: "install.errors.host",
    });
    expect(
      validateProvisionForm({
        ...EMPTY_PROVISION,
        name: "hel-1",
        public_host: "1.2.3.4",
        port: "x",
      }),
    ).toEqual({ port: "install.errors.port" });
  });

  it("accepts IPv4, names and IPv6 with or without brackets", () => {
    for (const h of ["203.0.113.10", "node.example.org", "2001:db8::1", "[2001:db8::1]"]) {
      expect(isValidHost(h), h).toBe(true);
    }
    for (const h of ["", "bad host", "[2001:db8::1", "node.example.org:22"]) {
      expect(isValidHost(h), h).toBe(false);
    }
  });

  it("omits the default profile and empty lists", () => {
    expect(
      provisionPayload({ ...EMPTY_PROVISION, name: " hel-1 ", public_host: "1.2.3.4 " }),
    ).toEqual({
      name: "hel-1",
      public_host: "1.2.3.4",
      port: 18081,
      backend: "sled",
      with_turn: true,
      auto_blob_reserve: true,
    });
    expect(
      provisionPayload({
        ...EMPTY_PROVISION,
        name: "a",
        public_host: "h",
        profile_id: "p1",
        turn_server_ids: ["t1"],
        labels: "env=prod",
      }),
    ).toMatchObject({ profile_id: "p1", turn_server_ids: ["t1"], labels: { env: "prod" } });
  });

  it("sends the auto blob reserve switch as is", () => {
    const v = { ...EMPTY_PROVISION, name: "a", public_host: "h" };
    expect(EMPTY_PROVISION.auto_blob_reserve).toBe(true);
    expect(provisionPayload({ ...v, auto_blob_reserve: false }).auto_blob_reserve).toBe(false);
    expect(provisionPayload(v).auto_blob_reserve).toBe(true);
  });
});
