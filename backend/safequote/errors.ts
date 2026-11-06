export class SafeQuoteApiError extends Error {
  public readonly status: number;
  public readonly endpoint: string;
  public readonly isNetworkError: boolean;
  public readonly isTimeout: boolean;
  public readonly isAuthError: boolean;
  public readonly isRateLimited: boolean;

  constructor(message: string, options: {
    status?: number;
    endpoint: string;
    isNetworkError?: boolean;
    isTimeout?: boolean;
    isAuthError?: boolean;
    cause?: unknown;
  }) {
    super(message, { cause: options.cause });
    this.name = "SafeQuoteApiError";
    this.status = options.status ?? 500;
    this.endpoint = options.endpoint;
    this.isNetworkError = Boolean(options.isNetworkError);
    this.isTimeout = Boolean(options.isTimeout);
    this.isAuthError = options.isAuthError ?? (this.status === 401 || this.status === 403);
    this.isRateLimited = this.status === 429;
  }
}
