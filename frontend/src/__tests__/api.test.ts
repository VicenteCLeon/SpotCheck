import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseSessionPayload,
  isTokenExpired,
  createCamera,
  deleteCamera,
  fetchCamerasConfig,
  UnauthorizedError,
} from "../api";

// Construye un JWT de juguete (header.payload.firma) con el payload dado.
function makeToken(payload: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(payload))}.sig`;
}

describe("parseSessionPayload", () => {
  it("lee el rol y el sub de un token válido", () => {
    const t = makeToken({ sub: "a@mail.pucv.cl", role: "admin", exp: 9999999999 });
    const p = parseSessionPayload(t);
    expect(p?.sub).toBe("a@mail.pucv.cl");
    expect(p?.role).toBe("admin");
  });

  it("usa 'viewer' cuando el token no trae rol", () => {
    const t = makeToken({ sub: "a@mail.pucv.cl", exp: 9999999999 });
    expect(parseSessionPayload(t)?.role).toBe("viewer");
  });

  it("devuelve null para un token malformado", () => {
    expect(parseSessionPayload("esto-no-es-un-jwt")).toBeNull();
  });
});

describe("isTokenExpired", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-06-02T12:00:00Z")));
  afterEach(() => vi.useRealTimers());

  it("token con exp futuro → no expirado", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired(makeToken({ sub: "x", exp: future }))).toBe(false);
  });

  it("token con exp pasado → expirado", () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    expect(isTokenExpired(makeToken({ sub: "x", exp: past }))).toBe(true);
  });

  it("token sin exp → expirado", () => {
    expect(isTokenExpired(makeToken({ sub: "x" }))).toBe(true);
  });
});

describe("mutate (vía createCamera/deleteCamera)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  function mockFetch(resp: Partial<Response> & { jsonData?: unknown }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      json: async () => resp.jsonData ?? {},
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("createCamera resuelve cuando la respuesta es OK", async () => {
    mockFetch({ ok: true, status: 201, jsonData: { ok: true } });
    await expect(createCamera("tok", {
      id: "cam9", name: "N", source: "0", capacity: 10, building: "", enabled: true, sort_order: 0,
    })).resolves.toBeUndefined();
  });

  it("createCamera lanza Error con el 'detail' del backend", async () => {
    mockFetch({ ok: false, status: 409, jsonData: { detail: "Ya existe una cámara con id 'cam9'." } });
    await expect(createCamera("tok", {
      id: "cam9", name: "N", source: "0", capacity: 10, building: "", enabled: true, sort_order: 0,
    })).rejects.toThrow("Ya existe una cámara");
  });

  it("deleteCamera lanza UnauthorizedError ante un 401", async () => {
    mockFetch({ ok: false, status: 401 });
    await expect(deleteCamera("tok", "cam9")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("fetchCamerasConfig", () => {
  it("devuelve el JSON del backend", async () => {
    const data = { source: "supabase", supabase: true, cameras: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => data,
    } as Response));
    await expect(fetchCamerasConfig("tok")).resolves.toEqual(data);
  });
});
