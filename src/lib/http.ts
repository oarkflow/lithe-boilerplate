import { ApiError } from './types.ts';

// One small, reusable JSON request helper for the plain same-origin
// endpoints (/auth/*, /secure-config.json). Every call is same-origin,
// credentialed, and never cached, matching what the server's origin checks
// require; callers only supply a path, method, and body.
export interface JSONRequestInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export async function requestJSON<T>(path: string, init: JSONRequestInit = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...rest,
    headers: { 'content-type': 'application/json', ...(headers as Record<string, string> | undefined) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseJSONResponse<T>(response);
}

// Shared between plain fetch responses and the responses secure-fetch
// returns from an encrypted call - both are standard Response objects once
// decrypted, so the same parsing/error contract applies to either.
export async function parseJSONResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { detail: text };
    }
  }
  if (!response.ok) {
    const record = (body ?? {}) as Record<string, unknown>;
    const detail = typeof record.detail === 'string' ? record.detail : undefined;
    const code = typeof record.code === 'string' ? record.code : undefined;
    throw new ApiError(detail || `request failed with status ${response.status}`, response.status, code, detail);
  }
  return body as T;
}
