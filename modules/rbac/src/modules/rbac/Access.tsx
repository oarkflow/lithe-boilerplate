import { onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Alert } from '../../components/ui/Alert.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, attempt, fmtTime, resource } from '../../lib/api.ts';
import { secureApi, type Json } from '../../lib/secure-client.ts';
import { Status } from '../../ui/bits.tsx';

interface Perm { action: string; resource: string }
interface Draft { id: string; name: string; isNew: boolean; system: boolean; perms: Set<string>; inherits: Set<string>; note: string }

const key = (p: Perm) => `${p.action}:${p.resource}`;
const split = (k: string): Perm => { const i = k.indexOf(':'); return { action: k.slice(0, i), resource: k.slice(i + 1) }; };

/**
 * Who may do what. Roles and their permissions live in the database and are
 * enforced by the authz engine on every request; an edit applies on the next
 * request. Each change needs a fresh authenticator code and is kept in a
 * history that can be rolled back.
 */
export function Access() {
  const roles = resource(() => api.get('/rbac/roles'));
  const members = resource(() => api.get('/rbac/members'));
  const accounts = resource(() => api.get('/accounts'));
  const history = resource(() => api.get('/rbac/history'));
  const denials = resource(() => api.get('/rbac/denials'));
  const draft = signal<Draft | undefined>(undefined);
  const totp = signal('');
  const saving = signal(false);
  const reloadAll = () => { void roles.reload(); void members.reload(); void accounts.reload(); void history.reload(); void denials.reload(); };
  onMount(reloadAll);

  const allRoles = () => (roles.data.value?.roles as Json[] | undefined) ?? [];
  const catalog = (): Perm[] => (roles.data.value?.catalog as Perm[] | undefined) ?? [];
  const resourcesOf = () => [...new Set(catalog().map((p) => p.resource))];
  const actionsFor = (res: string) => catalog().filter((p) => p.resource === res).map((p) => p.action);

  function edit(r: Json) {
    draft.value = {
      id: String(r.id), name: String(r.name), isNew: false, system: Boolean(r.system), note: '',
      perms: new Set(((r.permissions as Perm[] | undefined) ?? []).map(key)),
      inherits: new Set((r.inherits as string[] | undefined) ?? []),
    };
  }
  function fresh() { draft.value = { id: '', name: '', isNew: true, system: false, perms: new Set(), inherits: new Set(), note: '' }; }
  const code = () => totp.value.trim();
  // The server asks for a fresh authenticator code only from accounts that have enrolled one.
  const needCode = () => { if (code() !== '' && !/^\d{6}$/.test(code())) { window.alert('The authenticator code is 6 digits.'); return false; } return true; };

  async function save() {
    const d = draft.value;
    if (!d || !needCode()) return;
    saving.value = true;
    const out = await attempt(() => api.put(`/rbac/roles/${encodeURIComponent(d.id)}`, {
      name: d.name, permissions: [...d.perms].map(split), inherits: [...d.inherits], note: d.note, totp: code(),
    }), 'Role saved. It applies on the next request.');
    saving.value = false;
    if (out) { draft.value = undefined; reloadAll(); }
  }
  async function remove(id: string) {
    if (!needCode() || !window.confirm(`Delete the role "${id}"?`)) return;
    if (await attempt(() => secureApi.call('DELETE', `/api/rbac/roles/${encodeURIComponent(id)}`, { totp: code() }), 'Role deleted')) { draft.value = undefined; reloadAll(); }
  }
  async function grant(e: Event) {
    e.preventDefault();
    if (!needCode()) return;
    const f = new FormData(e.currentTarget as HTMLFormElement);
    if (await attempt(() => api.post('/rbac/members', { accountId: String(f.get('account')).trim(), roleId: String(f.get('role')), totp: code() }), 'Role granted')) reloadAll();
  }
  async function revoke(account: string, role: string) {
    if (!needCode()) return;
    if (await attempt(() => secureApi.call('DELETE', `/api/rbac/members/${encodeURIComponent(account)}/${encodeURIComponent(role)}`, { totp: code() }), 'Role revoked')) reloadAll();
  }
  async function rollback(rev: number) {
    if (!needCode() || !window.confirm(`Restore access to how it was at revision ${rev}?`)) return;
    if (await attempt(() => api.post('/rbac/rollback', { rev, totp: code() }), `Restored revision ${rev}`)) reloadAll();
  }

  const toggle = (set: Set<string>, k: string, on: boolean) => { if (on) set.add(k); else set.delete(k); };

  return (
    <div class="fh-panels">
      <Card eyebrow="Step-up" title="Authenticator code">
        <p class="fh-auth-card__lede">If you use an authenticator app, changing access needs a fresh code from it. Enter it here once, then make your changes.</p>
        <label class="fh-field"><span>6-digit code</span><input inputmode="numeric" maxlength="6" autocomplete="one-time-code" onInput={(e: Event) => { totp.value = (e.currentTarget as HTMLInputElement).value; }} /></label>
      </Card>

      <Card eyebrow="Access control" title="Roles" actions={<Button variant="subtle" onClick={fresh}>New role</Button>}>
        <Status r={roles as never} />
        <table class="ui-table"><thead><tr><th>Role</th><th>Can</th><th>Inherits</th><th /></tr></thead><tbody>
          <For each={() => allRoles()} key={(r: Json) => r.id} fallback={<tr><td colSpan={4} class="fh-muted">No roles.</td></tr>}>
            {(r: Json) => (
              <tr>
                <td><strong>{r.name}</strong> <code>{r.id}</code> {r.system ? <Badge tone="neutral">built-in</Badge> : <Badge tone="accent">custom</Badge>}</td>
                <td>{((r.permissions as Perm[]) ?? []).map(key).join(', ') || '—'}</td>
                <td>{((r.inherits as string[]) ?? []).join(', ') || '—'}</td>
                <td><Button variant="ghost" onClick={() => edit(r)}>Edit</Button></td>
              </tr>
            )}
          </For>
        </tbody></table>
      </Card>

      <Show when={() => Boolean(draft.value)}>
        {() => {
          const d = draft.value as Draft;
          return (
            <Card eyebrow={d.isNew ? 'New role' : 'Editing'} title={d.isNew ? 'Create a role' : `${d.name} (${d.id})`}
              actions={<Button variant="ghost" onClick={() => { draft.value = undefined; }}>Close</Button>}>
              <div class="fh-form">
                <Show when={() => d.isNew}>
                  <label class="fh-field"><span>Role id (lower-case letters, digits, underscore)</span><input value={d.id} maxlength="32" onInput={(e: Event) => { d.id = (e.currentTarget as HTMLInputElement).value.trim(); }} /></label>
                </Show>
                <label class="fh-field"><span>Name</span><input value={d.name} maxlength="60" onInput={(e: Event) => { d.name = (e.currentTarget as HTMLInputElement).value; }} /></label>
                <fieldset class="ui-scopes"><legend>Permissions</legend>
                  <table class="ui-table"><thead><tr><th>Area</th><th>Actions allowed</th></tr></thead><tbody>
                    <For each={() => resourcesOf()} key={(r: string) => r}>
                      {(res: string) => (
                        <tr><td><code>{res}</code></td><td>
                          <For each={() => actionsFor(res)} key={(a: string) => a}>
                            {(a: string) => <label class="ui-check"><input type="checkbox" checked={d.perms.has(`${a}:${res}`)} onChange={(e: Event) => toggle(d.perms, `${a}:${res}`, (e.currentTarget as HTMLInputElement).checked)} /> {a}</label>}
                          </For>
                        </td></tr>
                      )}
                    </For>
                  </tbody></table>
                </fieldset>
                <fieldset class="ui-scopes"><legend>Also gets everything from</legend>
                  <For each={() => allRoles().filter((r) => r.id !== d.id)} key={(r: Json) => r.id}>
                    {(r: Json) => <label class="ui-check"><input type="checkbox" checked={d.inherits.has(String(r.id))} onChange={(e: Event) => toggle(d.inherits, String(r.id), (e.currentTarget as HTMLInputElement).checked)} /> {r.name}</label>}
                  </For>
                </fieldset>
                <label class="fh-field"><span>Why? (kept in the history)</span><input maxlength="200" onInput={(e: Event) => { d.note = (e.currentTarget as HTMLInputElement).value; }} /></label>
                <Alert tone="info">You can only give a role permissions you hold yourself, and the last full-access role always keeps its wildcard.</Alert>
                <div class="ui-actions">
                  <Button busy={saving} onClick={() => void save()}>Save role</Button>
                  <Show when={() => !d.isNew && !d.system}><Button variant="danger" onClick={() => void remove(d.id)}>Delete role</Button></Show>
                </div>
              </div>
            </Card>
          );
        }}
      </Show>

      <Card eyebrow="Extra roles" title="Grant a role to an account">
        <p class="fh-auth-card__lede">An account keeps its own role and gains the roles granted here. Emails are partly hidden.</p>
        <form class="fh-form ui-grid" onSubmit={grant}>
          <label class="fh-field"><span>Account</span>
            <select name="account" required>
              <option value="">Choose an account…</option>
              <For each={() => (accounts.data.value?.accounts as Json[] | undefined) ?? []} key={(a: Json) => a.id}>{(a: Json) => <option value={String(a.id)}>{`${a.email} · ${a.role} · ${String(a.id).slice(0, 8)}`}</option>}</For>
            </select></label>
          <label class="fh-field"><span>Role</span>
            <select name="role"><For each={() => allRoles()} key={(r: Json) => r.id}>{(r: Json) => <option value={String(r.id)}>{`${r.name} (${r.id})`}</option>}</For></select></label>
          <Button type="submit" class="fh-form__submit">Grant</Button>
        </form>
        <table class="ui-table"><thead><tr><th>Account</th><th>Role</th><th>Granted by</th><th>When</th><th /></tr></thead><tbody>
          <For each={() => (members.data.value?.members as Json[] | undefined) ?? []} key={(m: Json) => `${m.accountId}:${m.roleId}`} fallback={<tr><td colSpan={5} class="fh-muted">No extra grants.</td></tr>}>
            {(m: Json) => <tr><td><code>{String(m.accountId).slice(0, 12)}</code></td><td>{m.roleId}</td><td>{String(m.grantedBy).slice(0, 10)}</td><td>{fmtTime(String(m.grantedAt))}</td>
              <td><Button variant="ghost" onClick={() => void revoke(String(m.accountId), String(m.roleId))}>Revoke</Button></td></tr>}
          </For>
        </tbody></table>
      </Card>

      <Card eyebrow="Change history" title="Revisions">
        <Status r={history as never} />
        <table class="ui-table"><thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th /></tr></thead><tbody>
          <For each={() => (history.data.value?.revisions as Json[] | undefined) ?? []} key={(h: Json) => h.rev}>
            {(h: Json) => <tr><td>{h.rev}</td><td>{fmtTime(String(h.at))}</td><td>{String(h.author).slice(0, 10)}</td><td>{h.note}</td>
              <td><Button variant="ghost" onClick={() => void rollback(Number(h.rev))}>Restore</Button></td></tr>}
          </For>
        </tbody></table>
      </Card>

      <Card eyebrow="Refused requests" title="Recent denials" actions={<Button variant="ghost" busy={denials.loading} onClick={() => void denials.reload()}>Refresh</Button>}>
        <table class="ui-table"><thead><tr><th>When</th><th>Account</th><th>Tried to</th><th>On</th></tr></thead><tbody>
          <For each={() => (denials.data.value?.denials as Json[] | undefined) ?? []} key={(d: Json) => `${d.at}${d.subject}${d.action}${d.resource}`} fallback={<tr><td colSpan={4} class="fh-muted">None.</td></tr>}>
            {(d: Json) => <tr><td>{fmtTime(String(d.at))}</td><td><code>{String(d.subject).slice(0, 12)}</code></td><td>{d.action}</td><td>{d.resource}</td></tr>}
          </For>
        </tbody></table>
      </Card>
    </div>
  );
}
