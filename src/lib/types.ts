// Shared, framework-independent types for the FH secure API client.
// Keeping these separate from the components that consume them is what
// makes the client reusable: any panel/page can import from here without
// pulling in UI code.

export interface SessionStatus {
  authenticated: boolean;
  userID?: string;
}

export interface SecureBootstrapConfig {
  baseURL: string;
  pinnedServerKey: string;
  pinnedServerKeyID: string;
  responseSigningPublicKey: string;
  responseSigningKeyID: string;
  requireResponseSignature: boolean;
  requireEmbeddedTrust: boolean;
  registrationToken: string;
  wasmURL: string;
  wasmExecURL: string;
  wasmIntegrity: string;
  wasmExecIntegrity: string;
  requireAssetIntegrity: boolean;
}

// The shape of the object `createSecureFetch()` resolves to, from
// web/wasm/secure-fetch.js. Declared narrowly here so the rest of the app
// depends on a small, typed contract instead of `any`.
export interface SecureFetchClient {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  sessionInfo(): Record<string, unknown>;
  revokeSession(): Promise<void>;
}

export interface WasmBridge {
  createSecureFetch(config: Record<string, unknown>): Promise<SecureFetchClient>;
}

export interface ProfileResponse {
  userID: string;
  roles: string[];
  securePrincipal?: unknown;
}

export interface EchoResponse {
  accepted: boolean;
  body: unknown;
}

// A normalized error every API call in this app throws, whether it came
// from a plain fetch to /auth/* or an encrypted call through secure-fetch.
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: string;

  constructor(message: string, status: number, code?: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
