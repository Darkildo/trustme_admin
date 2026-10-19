import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, CSRF_HEADER, request, setUnauthorizedHandler } from "./api";

type FetchArgs = [string, RequestInit];

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("api client", () => {
  const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  const headersOf = (call: number) => new Headers(fetchMock.mock.calls[call]![1].headers);

  it("adds the CSRF header to POST/PATCH/DELETE but not to GET", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { node: {} }));
    await request("GET", "/nodes");
    await request("POST", "/nodes", { name: "a" });
    await request("PATCH", "/nodes/1", { name: "b" });
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    await request("DELETE", "/nodes/1");

    expect(headersOf(0).has(CSRF_HEADER)).toBe(false);
    expect(headersOf(1).get(CSRF_HEADER)).toBe("1");
    expect(headersOf(2).get(CSRF_HEADER)).toBe("1");
    expect(headersOf(3).get(CSRF_HEADER)).toBe("1");
  });

  it("uses same-origin credentials and the /api/v1 prefix", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: "ok", version: "0.1.0" }));
    await api.health();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/health");
    expect(init.credentials).toBe("same-origin");
  });

  it("parses {error:{code,message}} into a typed ApiError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: "invalid_input", message: "addr: ожидается host:port" } }),
    );
    const err = await api.nodes
      .create({ name: "x", addr: "bad", node_key: "0" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: "invalid_input",
      message: "addr: ожидается host:port",
      status: 400,
    });
  });

  it("reads Retry-After on 429", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        429,
        { error: { code: "rate_limited", message: "slow down" } },
        { "Retry-After": "30" },
      ),
    );
    const err = (await api.auth
      .login({ username: "a", password: "b" })
      .catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(30);
  });

  it("falls back to a generic code when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    const err = (await api.overview().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("internal");
    expect(err.status).toBe(502);
  });

  it("maps network failures to code 'network'", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = (await api.overview().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("network");
    expect(err.status).toBe(0);
  });

  it("calls the unauthorized handler on 401 outside of /auth", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockImplementation(async () =>
      jsonResponse(401, { error: { code: "unauthorized", message: "no session" } }),
    );
    await api.nodes.list().catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);

    await api.auth.login({ username: "a", password: "b" }).catch(() => undefined);
    await api.auth.me().catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not redirect on totp_required", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "totp_required", message: "code" } }),
    );
    const err = (await api.auth
      .login({ username: "a", password: "b" })
      .catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("totp_required");
    expect(handler).not.toHaveBeenCalled();
  });

  it("reads and applies the node blob reserve", async () => {
    const reserve = {
      available_bytes: 4_724_464_026,
      total_bytes: 14_495_514_624,
      reserve_bytes: 5_368_709_120,
      suggested_bytes: 1_342_177_280,
      panel_bytes: null,
      managed: true,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, reserve));
    await expect(api.nodes.blobReserve("01H/X")).resolves.toEqual(reserve);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { reserve_bytes: 1_342_177_280 }));
    await expect(api.nodes.applyBlobReserve("01H/X")).resolves.toEqual({
      reserve_bytes: 1_342_177_280,
    });

    const [getUrl, getInit] = fetchMock.mock.calls[0]!;
    expect(getUrl).toBe("/api/v1/nodes/01H%2FX/blob-reserve");
    expect(getInit.method).toBe("GET");
    const [postUrl, postInit] = fetchMock.mock.calls[1]!;
    expect(postUrl).toBe("/api/v1/nodes/01H%2FX/blob-reserve");
    expect(postInit.method).toBe("POST");
    expect(postInit.body).toBeUndefined();
    expect(headersOf(1).get(CSRF_HEADER)).toBe("1");
  });

  it("surfaces 409 from the blob reserve as a conflict", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: "conflict", message: "у ноды нет агента" } }),
    );
    const err = (await api.nodes.applyBlobReserve("n1").catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ code: "conflict", status: 409, message: "у ноды нет агента" });
  });

  it("unwraps envelopes and returns undefined for 204", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { user: { id: "u1", username: "alice" } }));
    const user = await api.setup.complete({
      token: "t",
      username: "alice",
      password: "0123456789",
    });
    expect(user).toMatchObject({ id: "u1", username: "alice" });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.auth.logout()).resolves.toBeUndefined();
  });
});
