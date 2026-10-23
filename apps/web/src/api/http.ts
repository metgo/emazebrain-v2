/**
 * Thin fetch wrapper for the /v1 API. Cookies carry the session; every error
 * becomes an ApiError with the HTTP status, the API's error code and the
 * request id (shown to the user as a reference, never with patient data).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(`${status} ${code}`);
  }
}

export async function apiGet<T>(path: string, init: { signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "include", headers: { accept: "application/json" }, ...(init.signal ? { signal: init.signal } : {}) });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network");
  }
  const requestId = res.headers.get("x-request-id") ?? undefined;
  const body = (await res.json().catch(() => null)) as (T & { error?: string; requestId?: string }) | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "unknown", body?.requestId ?? requestId);
  return body as T;
}
