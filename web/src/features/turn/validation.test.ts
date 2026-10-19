import { describe, expect, it } from "vitest";
import {
  isRelayUrl,
  turnPayload,
  validateTurnForm,
  validateTurnUrl,
  type TurnFormValues,
} from "./validation";

describe("TURN URL validation", () => {
  it("accepts the schemes and forms the node accepts", () => {
    for (const url of [
      "stun:stun.example.net",
      "stun:stun.example.net:3478",
      "stuns:stun.example.net:5349",
      "turn:turn.example.org:3478?transport=udp",
      "turn:turn.example.org:3478?transport=tcp",
      "turns:turn.example.org:443",
      "turn:203.0.113.10:3478",
      "turn:[2001:db8::1]:3478?transport=udp",
    ]) {
      expect(validateTurnUrl(url), url).toBeNull();
    }
  });

  it("explains what is wrong", () => {
    expect(validateTurnUrl("")).toBe("empty");
    expect(validateTurnUrl("http://turn.example.org")).toBe("scheme");
    expect(validateTurnUrl("turn://turn.example.org")).toBe("host");
    expect(validateTurnUrl("turn:")).toBe("host");
    expect(validateTurnUrl("turn:bad_host:3478")).toBe("host");
    expect(validateTurnUrl("turn:turn.example.org:0")).toBe("port");
    expect(validateTurnUrl("turn:turn.example.org:70000")).toBe("port");
    expect(validateTurnUrl("turn:turn.example.org:3478?transport=sctp")).toBe("transport");
    expect(validateTurnUrl("stun:stun.example.net:3478?transport=udp")).toBe("transport");
  });

  it("knows which URLs relay traffic", () => {
    expect(isRelayUrl("TURN:x.org")).toBe(true);
    expect(isRelayUrl("turns:x.org")).toBe(true);
    expect(isRelayUrl("stun:x.org")).toBe(false);
  });
});

const form = (p: Partial<TurnFormValues>): TurnFormValues => ({
  name: "turn-eu",
  urls: ["turn:turn.example.org:3478"],
  secretMode: "keep",
  secret: "",
  ...p,
});

describe("TURN form", () => {
  it("requires a secret of 16+ characters for turn: URLs", () => {
    expect(validateTurnForm(form({}), false).secret).toBe("turn.errors.secretNeeded");
    expect(validateTurnForm(form({}), true).secret).toBeUndefined();
    expect(validateTurnForm(form({ secretMode: "set", secret: "short" }), false).secret).toBe(
      "turn.errors.secretShort",
    );
    expect(validateTurnForm(form({ secretMode: "remove" }), true).secret).toBe(
      "turn.errors.secretNeeded",
    );
    expect(
      validateTurnForm(form({ urls: ["stun:stun.example.net"], secretMode: "remove" }), true)
        .secret,
    ).toBeUndefined();
  });

  it("limits and checks the URL list", () => {
    const many = Array.from({ length: 9 }, (_, i) => `stun:s${i}.example.net`);
    expect(validateTurnForm(form({ urls: many }), false).list).toBe("turn.errors.tooMany");
    expect(validateTurnForm(form({ urls: [""] }), false).list).toBe("turn.errors.noUrls");
    const dup = validateTurnForm(
      form({ urls: ["stun:a.example.net", "STUN:a.example.net"] }),
      false,
    );
    expect(dup.urls).toEqual([undefined, "turn.errors.duplicate"]);
  });

  it("sends the secret only when it changes", () => {
    expect(turnPayload(form({ urls: [" stun:a.net ", ""] }))).toEqual({
      name: "turn-eu",
      urls: ["stun:a.net"],
    });
    expect(turnPayload(form({ secretMode: "set", secret: "0123456789abcdef" })).secret).toBe(
      "0123456789abcdef",
    );
    expect(turnPayload(form({ secretMode: "remove" })).secret).toBe("");
  });
});
