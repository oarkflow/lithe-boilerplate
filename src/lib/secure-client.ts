import { loadWasmBridge } from './wasm-bridge.ts';
import { requestJSON, parseJSONResponse } from './http.ts';
import {
  ApiError,
  isEmptyResponse,
  isLoginResponse,
  isSecureBootstrapConfig,
  isSessionStatus,
} from './types.ts';
import type {
  SecureBootstrapConfig,
  SecureFetchClient,
  SessionStatus,
} from './types.ts';

// A single, structured, reusable client for every call this app makes.
// It is deliberately the only module that knows about /auth/*,
// /secure-config.json, /api/*, and the WASM secure transport - every
// component below calls through here instead of touching `fetch` or the
// WASM bridge directly, so adding a new page or a new API only ever means
// adding one function to this file plus one call site.

let secure: SecureFetchClient | undefined;

/** Plain, unauthenticated/session-cookie endpoints. */
export const authApi = {
  session: () => requestJSON<SessionStatus>('/auth/session', isSessionStatus, { method: 'GET' }),

  /** Public settings the sign-in screen needs: tenancy, registration, identifier, MFA mode. */
  config: () => requestJSON<AuthConfig>('/auth/config', isAnyRecord as unknown as (v: unknown) => v is AuthConfig, { method: 'GET' }).catch(() => DEFAULT_AUTH_CONFIG),

  register: (input: { email?: string; phone?: string; name?: string; password: string; tenant?: string }) =>
    requestJSON<Record<string, unknown>>('/auth/register', isAnyRecord, { method: 'POST', body: input }),

  verifyOtp: (accountId: string, code: string) =>
    requestJSON<Record<string, unknown>>('/auth/verify', isAnyRecord, { method: 'POST', body: { accountId, code } }),

  login: (username: string, password: string, extra: { otp?: string; tenant?: string } = {}) =>
    requestJSON<{ authenticated: boolean }>('/auth/login', isLoginResponse, {
      method: 'POST',
      body: { username, password, ...extra },
    }),

  logout: async () => {
    await requestJSON('/auth/logout', isEmptyResponse, { method: 'POST' });
  },
};

export interface AuthConfig { multiTenant: boolean; defaultTenant: string; registration: boolean; identifier: string; mfa: string }
const DEFAULT_AUTH_CONFIG: AuthConfig = { multiTenant: false, defaultTenant: 'default', registration: false, identifier: 'username', mfa: 'optional' };
const isAnyRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Bootstraps the encrypted WASM transport: fetches a one-use registration
 * grant and the server's public trust pins, loads the secure-fetch WASM
 * runtime, and registers/derives an encrypted session bound to the current
 * login. Safe to call more than once - later calls reuse the live session.
 */
export async function ensureSecureSession(): Promise<SecureFetchClient> {
  if (secure) return secure;
  const config = await requestJSON<SecureBootstrapConfig>('/secure-config.json', isSecureBootstrapConfig, { method: 'POST' });
  const { createSecureFetch } = await loadWasmBridge();
  secure = await createSecureFetch({
    ...config,
    credentials: 'same-origin',
    clientBuild: 'fh-control-center-1',
    deviceName: deviceLabel(),
  });
  return secure;
}

export function secureSessionInfo(): Record<string, unknown> | undefined {
  return secure?.sessionInfo();
}

export async function revokeSecureSession(): Promise<void> {
  if (secure) await secure.revokeSession().catch(() => undefined);
  secure = undefined;
  await forgetDevice();
}

/**
 * Forgets this browser's device key. A device key is bound to the account that first
 * registered it, so signing out must drop it or the next person to sign in on this
 * browser would fail the session-binding check.
 */
async function forgetDevice(): Promise<void> {
  try {
    const { clearDevice } = await loadWasmBridge();
    await clearDevice();
  } catch {
    /* storage unavailable: nothing to forget */
  }
}

export function hasSecureSession(): boolean {
  return secure !== undefined;
}

/**
 * Encrypted, authenticated `/api/*` calls. Every one goes through secure-fetch;
 * this is the only place the application issues them.
 */
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type JsonList = Json[];
export type Strs = string[];

export const secureApi = {
  async call(method: string, path: string, body?: unknown): Promise<Json> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    // One transparent re-bootstrap: the encrypted session lives in server memory, so a
    // server restart or expiry makes it unknown while the cookie session may still be fine.
    for (let attempt = 0; ; attempt++) {
      try {
        const client = await requireSecureClient();
        const response = await client.fetch(path, init);
        return await parseJSONResponse<Json>(response, isAnyRecord as (v: unknown) => v is Json);
      } catch (error) {
        const lost = error instanceof ApiError ? error.status === 401 : /unprotected|unknown session|session/i.test(String((error as Error)?.message ?? ''));
        if (!lost || attempt > 0) {
          if (lost) sessionLost();
          throw error;
        }
        secure = undefined;
      }
    }
  },
};

/** Registered by the state layer: called when no session can be re-established. */
let onSessionLost: (() => void) | undefined;
export function setSessionLostHandler(fn: () => void): void { onSessionLost = fn; }
function sessionLost(): void { secure = undefined; void forgetDevice(); onSessionLost?.(); }

async function requireSecureClient(): Promise<SecureFetchClient> {
  if (secure) return secure;
  return ensureSecureSession();
}

function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser';
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return platform || navigator.platform || 'Browser';
}

export { ApiError };
