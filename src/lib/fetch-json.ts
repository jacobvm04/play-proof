"use client";

// Safe JSON fetch. Serverless functions can occasionally time out (504) and
// return an HTML error page, which crashes a naive res.json() with
// "Unexpected token '<'". This wraps fetch so callers always get a typed result
// with a clean, human error instead of a parse crash.

export type JsonResult<T = any> = { ok: true; data: T } | { ok: false; error: string };

export async function fetchJson<T = any>(
  input: RequestInfo,
  init?: RequestInit & { timeoutMs?: number }
): Promise<JsonResult<T>> {
  const timeoutMs = init?.timeoutMs ?? 90_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body (almost always an HTML gateway/timeout page).
      if (res.status === 504 || res.status === 502)
        return { ok: false, error: "The server took too long (the recording may be large). Please try again." };
      return { ok: false, error: `Unexpected server response (${res.status}). Please try again.` };
    }
    if (!res.ok || (data && data.ok === false)) {
      return { ok: false, error: data?.error || `Request failed (${res.status}).` };
    }
    return { ok: true, data };
  } catch (e: any) {
    if (e?.name === "AbortError")
      return { ok: false, error: "Timed out waiting for the server. Please try again." };
    return { ok: false, error: e?.message || "Network error. Please try again." };
  } finally {
    clearTimeout(timer);
  }
}
