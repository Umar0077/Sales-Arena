import { describe, expect, it, vi, beforeEach } from "vitest";
import { SafeQuoteClient } from "@/lib/server/safequote/client";
import { SafeQuoteApiError } from "@/lib/server/safequote/errors";

describe("SafeQuoteClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports unconfigured when token is absent", () => {
    const client = new SafeQuoteClient({ token: "" });
    expect(client.isConfigured()).toBe(false);
  });

  it("reports configured when token is set", () => {
    const client = new SafeQuoteClient({ token: "test_secret_token" });
    expect(client.isConfigured()).toBe(true);
  });

  it("throws SafeQuoteApiError with isAuthError when unconfigured", async () => {
    const client = new SafeQuoteClient({ token: "" });
    await expect(client.getSummary()).rejects.toThrow(SafeQuoteApiError);
  });

  it("includes Bearer token in request headers and parses summary response", async () => {
    const mockSummary = {
      range: { from: "2026-10-28", to: "2026-10-28" },
      submitted: 227,
      validated: 120,
      closeRate: 52.86,
      returned: 66,
      rejected: 38,
      activeClosers: 20,
      premium: { total: 50070.44, average: 417.25 },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummary,
    } as Response);

    const client = new SafeQuoteClient({ token: "my_token", baseUrl: "https://portal.thesafequote.com/api/sales-arena" });
    const res = await client.getSummary({ from: "2026-10-28", to: "2026-10-28" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    const url = new URL(callArgs[0] as string);
    expect(url.pathname).toBe("/api/sales-arena/summary");
    expect(url.searchParams.get("from")).toBe("2026-10-28");
    expect(url.searchParams.get("to")).toBe("2026-10-28");

    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my_token");

    expect(res.validated).toBe(120);
    expect(res.submitted).toBe(227);
    expect(res.closeRate).toBe(52.86);
  });

  it("handles upstream HTTP error responses with status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid API key",
    } as Response);

    const client = new SafeQuoteClient({ token: "invalid_token" });
    await expect(client.getSummary()).rejects.toThrow(SafeQuoteApiError);
  });
});
