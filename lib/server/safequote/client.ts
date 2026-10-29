import { SafeQuoteApiError } from "./errors";
import {
  SafeQuoteSummarySchema,
  SafeQuoteClosersResponseSchema,
  SafeQuoteStatesResponseSchema,
  SafeQuoteRecentSalesResponseSchema,
  type SafeQuoteSummary,
  type SafeQuoteClosersResponse,
  type SafeQuoteStatesResponse,
  type SafeQuoteRecentSalesResponse,
} from "./schemas";

export interface SafeQuoteDateFilter {
  from?: string;
  to?: string;
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class SafeQuoteClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(options: {
    baseUrl?: string;
    token?: string;
    timeoutMs?: number;
  } = {}) {
    this.baseUrl = (options.baseUrl || process.env.SALES_ARENA_API_URL || "https://portal.thesafequote.com/api/sales-arena").replace(/\/+$/, "");
    this.token = options.token || process.env.SALES_ARENA_API_TOKEN || "";
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  public isConfigured(): boolean {
    return Boolean(this.token && this.token.trim().length > 0);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public clearCache(): void {
    this.cache.clear();
  }

  private async fetchWithAuth(endpoint: string, queryParams?: Record<string, string | undefined>): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new SafeQuoteApiError("Safe Quote API token is not configured on the server", {
        status: 401,
        endpoint,
        isAuthError: true,
      });
    }

    const url = new URL(`${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, v);
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "User-Agent": "SalesArena/1.0",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        let errorDetail = "";
        try {
          const body = await response.text();
          errorDetail = body.slice(0, 300);
        } catch {
          // ignore error body parsing failure
        }

        throw new SafeQuoteApiError(`Safe Quote upstream returned HTTP ${response.status}: ${errorDetail || response.statusText}`, {
          status: response.status,
          endpoint,
        });
      }

      return await response.json();
    } catch (err: unknown) {
      if (err instanceof SafeQuoteApiError) {
        throw err;
      }

      const isTimeout = err instanceof Error && err.name === "AbortError";
      throw new SafeQuoteApiError(
        isTimeout ? `Safe Quote API request to ${endpoint} timed out after ${this.timeoutMs}ms` : `Safe Quote API request to ${endpoint} failed: ${err instanceof Error ? err.message : String(err)}`,
        {
          endpoint,
          isTimeout,
          isNetworkError: !isTimeout,
          cause: err,
        }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET /summary
   * Optional date filter: ?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  public async getSummary(filter?: SafeQuoteDateFilter, bypassCache = false): Promise<SafeQuoteSummary> {
    const cacheKey = `summary:${filter?.from ?? ""}:${filter?.to ?? ""}`;
    if (!bypassCache) {
      const cached = this.getCache<SafeQuoteSummary>(cacheKey);
      if (cached) return cached;
    }

    const raw = await this.fetchWithAuth("/summary", {
      from: filter?.from,
      to: filter?.to,
    });

    const parsed = SafeQuoteSummarySchema.parse(raw);
    this.setCache(cacheKey, parsed, 5_000); // 5-second cache
    return parsed;
  }

  /**
   * GET /closers
   * Optional date filter if supported upstream
   */
  public async getClosers(filter?: SafeQuoteDateFilter, bypassCache = false): Promise<SafeQuoteClosersResponse> {
    const cacheKey = `closers:${filter?.from ?? ""}:${filter?.to ?? ""}`;
    if (!bypassCache) {
      const cached = this.getCache<SafeQuoteClosersResponse>(cacheKey);
      if (cached) return cached;
    }

    const raw = await this.fetchWithAuth("/closers", {
      from: filter?.from,
      to: filter?.to,
    });

    const parsed = SafeQuoteClosersResponseSchema.parse(raw);
    this.setCache(cacheKey, parsed, 5_000);
    return parsed;
  }

  /**
   * GET /states
   * Optional date filter if supported upstream
   */
  public async getStates(filter?: SafeQuoteDateFilter, bypassCache = false): Promise<SafeQuoteStatesResponse> {
    const cacheKey = `states:${filter?.from ?? ""}:${filter?.to ?? ""}`;
    if (!bypassCache) {
      const cached = this.getCache<SafeQuoteStatesResponse>(cacheKey);
      if (cached) return cached;
    }

    const raw = await this.fetchWithAuth("/states", {
      from: filter?.from,
      to: filter?.to,
    });

    const parsed = SafeQuoteStatesResponseSchema.parse(raw);
    this.setCache(cacheKey, parsed, 10_000);
    return parsed;
  }

  /**
   * GET /recent-sales
   */
  public async getRecentSales(filter?: SafeQuoteDateFilter, bypassCache = false): Promise<SafeQuoteRecentSalesResponse> {
    const cacheKey = `recent-sales:${filter?.from ?? ""}:${filter?.to ?? ""}`;
    if (!bypassCache) {
      const cached = this.getCache<SafeQuoteRecentSalesResponse>(cacheKey);
      if (cached) return cached;
    }

    const raw = await this.fetchWithAuth("/recent-sales", {
      from: filter?.from,
      to: filter?.to,
    });
    const parsed = SafeQuoteRecentSalesResponseSchema.parse(raw);
    this.setCache(cacheKey, parsed, 3_000); // 3-second cache
    return parsed;
  }

  /**
   * Diagnostic health check
   */
  public async checkHealth(): Promise<{
    ok: boolean;
    configured: boolean;
    baseUrl: string;
    latencyMs: number | null;
    error?: string;
  }> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        configured: false,
        baseUrl: this.baseUrl,
        latencyMs: null,
        error: "SALES_ARENA_API_TOKEN is not configured in server environment",
      };
    }

    const start = Date.now();
    try {
      await this.getSummary(undefined, true);
      return {
        ok: true,
        configured: true,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// Singleton server-side instance
let clientInstance: SafeQuoteClient | null = null;

export function getSafeQuoteClient(): SafeQuoteClient {
  if (!clientInstance) {
    clientInstance = new SafeQuoteClient();
  }
  return clientInstance;
}
