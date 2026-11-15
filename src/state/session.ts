import { computed, signal } from '@oarkflow/lithe/core';
import {
  authApi,
  ensureSecureSession,
  revokeSecureSession,
  secureSessionInfo,
  setSessionLostHandler,
  type AuthConfig,
  type Json,
} from '../lib/secure-client.ts';
import { api } from '../lib/api.ts';
import { describeError, type EchoResponse, type ProfileResponse } from '../lib/types.ts';
import { modules } from '../modules/registry.ts';
import type { ModuleDef } from '../modules/types.ts';

// The application's whole client state lives in this module as a handful
// of signals plus the actions that mutate them. Components only ever read
// signals and call actions - none of them talk to `secure-client` directly,
// which keeps the data flow in one direction and the UI layer replaceable.

export type Phase = 'checking' | 'guest' | 'signing-in' | 'authenticated';
/** A built-in panel ('overview' | 'api' | 'activity') or the id of a module. */
export type Panel = string;

export interface ActivityEntry {
  id: number;
  at: number;
  label: string;
  status: 'ok' | 'error' | 'pending';
  detail?: string;
}

export const phase = signal<Phase>('checking', { name: 'phase' });
export const userID = signal<string | undefined>(undefined, { name: 'userID' });
export const displayName = signal<string | undefined>(undefined, { name: 'displayName' });
export const tenant = signal<string | undefined>(undefined, { name: 'tenant' });
export const roles = signal<string[]>([], { name: 'roles' });
/** Permissions the server says this person holds (GET /api/permissions). */
export const permissions = signal<string[]>([], { name: 'permissions' });
export const authConfig = signal<AuthConfig | undefined>(undefined, { name: 'authConfig' });
export const profile = signal<ProfileResponse | undefined>(undefined, { name: 'profile' });
export const lastEcho = signal<EchoResponse | undefined>(undefined, { name: 'lastEcho' });
export const secureInfo = signal<Record<string, unknown> | undefined>(undefined, { name: 'secureInfo' });
export const activity = signal<ActivityEntry[]>([], { name: 'activity' });
export const formError = signal<string | undefined>(undefined, { name: 'formError' });
/** Set when the server asks for a second factor, so the form can show the field. */
export const otpRequired = signal(false, { name: 'otpRequired' });
export const busy = signal(false, { name: 'busy' });

export const isAuthenticated = computed(() => phase.value === 'authenticated');
export const isChecking = computed(() => phase.value === 'checking');

/** Whether the signed-in person holds a "resource:action" permission. */
export function can(permission: string): boolean {
  return permissions.value.includes(permission);
}

/** The modules this person may use, in sidebar order. */
export const visibleModules = computed<ModuleDef[]>(() =>
  modules
    .filter((m) => {
      if (m.permission) return can(m.permission);
      if (m.anyPermission) return m.anyPermission.some(can);
      return true;
    })
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
);

export const activePanel = signal<Panel>('overview', { name: 'activePanel' });

export function selectPanel(panel: Panel): void {
  activePanel.value = panel;
  try {
    history.replaceState(null, '', '#' + panel);
  } catch {
    /* ignore */
  }
}

let activitySeq = 0;
function record(label: string, status: ActivityEntry['status'], detail?: string) {
  const entry: ActivityEntry = { id: ++activitySeq, at: Date.now(), label, status, detail };
  activity.value = [entry, ...activity.value].slice(0, 12);
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T> {
  busy.value = true;
  try {
    return await fn();
  } finally {
    busy.value = false;
  }
}

setSessionLostHandler(() => {
  phase.value = 'guest';
  formError.value = 'Your session ended. Please sign in again.';
});

async function enter(status: { userID?: string; name?: string; tenant?: string; roles?: string[] }): Promise<void> {
  userID.value = status.userID;
  displayName.value = status.name;
  tenant.value = status.tenant;
  roles.value = status.roles ?? [];
  await ensureSecureSession();
  secureInfo.value = secureSessionInfo();
  try {
    permissions.value = ((await api.get('/permissions')).permissions as string[] | undefined) ?? [];
  } catch {
    permissions.value = [];
  }
  const wanted = location.hash.slice(1);
  if (wanted && (wanted === 'overview' || wanted === 'api' || wanted === 'activity' || visibleModules.value.some((m) => m.id === wanted))) {
    activePanel.value = wanted;
  }
  phase.value = 'authenticated';
}

/** Called once on boot: loads the public sign-in settings, restores an existing web login, if any, and re-establishes the secure session. */
export async function restoreSession(): Promise<void> {
  authConfig.value = await authApi.config();
  try {
    const status = await authApi.session();
    if (!status.authenticated) {
      phase.value = 'guest';
      return;
    }
    await enter(status);
    record('Restored existing session', 'ok', status.userID);
  } catch (error) {
    phase.value = 'guest';
    record('Session restore failed', 'error', describeError(error));
  }
}

export async function signIn(username: string, password: string, extra: { otp?: string; tenant?: string } = {}): Promise<void> {
  formError.value = undefined;
  phase.value = 'signing-in';
  await withBusy(async () => {
    try {
      await authApi.login(username, password, extra);
      await enter(await authApi.session());
      otpRequired.value = false;
      record('Signed in', 'ok', username);
    } catch (error) {
      phase.value = 'guest';
      const code = (error as { code?: string }).code;
      if (code === 'OTP_REQUIRED') otpRequired.value = true;
      formError.value = describeError(error);
      record('Sign-in failed', 'error', describeError(error));
    }
  });
}

export async function signOut(): Promise<void> {
  await withBusy(async () => {
    try {
      await revokeSecureSession();
      await authApi.logout();
      record('Signed out', 'ok');
    } catch (error) {
      record('Sign-out request failed', 'error', describeError(error));
    } finally {
      userID.value = undefined;
      displayName.value = undefined;
      tenant.value = undefined;
      roles.value = [];
      permissions.value = [];
      profile.value = undefined;
      lastEcho.value = undefined;
      secureInfo.value = undefined;
      activePanel.value = 'overview';
      phase.value = 'guest';
    }
  });
}

export async function loadProfile(): Promise<void> {
  await withBusy(async () => {
    try {
      profile.value = (await api.get('/me')) as unknown as ProfileResponse;
      record('Loaded protected profile', 'ok', '/api/me');
    } catch (error) {
      record('Profile request failed', 'error', describeError(error));
    }
  });
}

export async function sendEcho(payload: unknown): Promise<void> {
  await withBusy(async () => {
    try {
      lastEcho.value = (await api.post('/echo', payload)) as unknown as EchoResponse;
      record('Sent encrypted echo', 'ok', '/api/echo');
    } catch (error) {
      record('Echo request failed', 'error', describeError(error));
    }
  });
}

export type { Json };
