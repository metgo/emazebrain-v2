/**
 * Thin fetch wrapper for the /v1 API. Cookies carry the session; every error
 * becomes an ApiError with the HTTP status, the API's error code and the
 * request id (shown to the user as a reference, never with patient data).
 */
export interface FieldIssue {
  path: string;
  code: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly issues: FieldIssue[] = [],
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

/** POST / PATCH / DELETE with a JSON body. Same errors as apiGet, plus field issues on 400. */
export async function apiSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const requestId = res.headers.get("x-request-id") ?? undefined;
  const data = (await res.json().catch(() => null)) as (T & { error?: string; requestId?: string; issues?: FieldIssue[] }) | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "unknown", data?.requestId ?? requestId, data?.issues ?? []);
  return data as T;
}
