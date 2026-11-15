import { onMount } from '@oarkflow/lithe/core';
import { For } from '@oarkflow/lithe/dom';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, attempt, fmtTime, formData, resource } from '../../lib/api.ts';
import { secureApi, type Json } from '../../lib/secure-client.ts';
import { Status, toneFor } from '../../ui/bits.tsx';

/** Accounts of the built-in datasource: create, change role, disable. */
export function Accounts() {
  const r = resource(() => api.get('/accounts'));
  onMount(() => { void r.reload(); });
  const list = (): Json[] => (r.data.value?.accounts as Json[] | undefined) ?? [];
  const roles = (): Json[] => (r.data.value?.roles as Json[] | undefined) ?? [];

  async function create(e: Event) {
    const f = formData(e);
    if (await attempt(() => api.post('/accounts', { email: f.email, name: f.name, password: f.password, role: f.role }), 'Account created')) { (e.currentTarget as HTMLFormElement).reset(); void r.reload(); }
  }
  async function patch(id: string, body: Json) {
    if (await attempt(() => secureApi.call('PATCH', `/api/accounts/${encodeURIComponent(id)}`, body), 'Saved')) void r.reload();
  }
  return (
    <div class="fh-panels">
      <Card eyebrow="People" title="Accounts" actions={<Button variant="ghost" busy={r.loading} onClick={() => void r.reload()}>Refresh</Button>}>
        <Status r={r as never} />
        <table class="ui-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>2-step</th><th>Created</th><th /></tr></thead><tbody>
          <For each={list} key={(a: Json) => a.id} fallback={<tr><td colSpan={7} class="fh-muted">No accounts in the built-in datasource.</td></tr>}>
            {(a: Json) => (
              <tr>
                <td>{String(a.name || '—')}</td><td>{String(a.email)}</td>
                <td>
                  <select onChange={(e: Event) => void patch(String(a.id), { role: (e.currentTarget as HTMLSelectElement).value })}>
                    <For each={roles} key={(ro: Json) => ro.id}>{(ro: Json) => <option value={String(ro.id)} selected={a.role === ro.id}>{String(ro.title || ro.id)}</option>}</For>
                  </select>
                </td>
                <td><Badge tone={toneFor(String(a.status))} dot>{String(a.status)}</Badge></td>
                <td>{a.totpEnabled ? 'on' : 'off'}</td><td>{fmtTime(String(a.createdAt))}</td>
                <td><Button variant="ghost" onClick={() => void patch(String(a.id), { status: a.status === 'active' ? 'disabled' : 'active' })}>{a.status === 'active' ? 'Disable' : 'Enable'}</Button></td>
              </tr>
            )}
          </For>
        </tbody></table>
      </Card>
      <Card eyebrow="New" title="Create an account">
        <form class="fh-form ui-grid" onSubmit={(e: Event) => void create(e)}>
          <label class="fh-field"><span>Name</span><input name="name" /></label>
          <label class="fh-field"><span>Email</span><input name="email" type="email" required /></label>
          <label class="fh-field"><span>Password</span><input name="password" type="password" autocomplete="new-password" required /></label>
          <label class="fh-field"><span>Role</span>
            <select name="role"><For each={roles} key={(ro: Json) => ro.id}>{(ro: Json) => <option value={String(ro.id)}>{String(ro.title || ro.id)}</option>}</For></select></label>
          <Button type="submit" class="fh-form__submit">Create</Button>
        </form>
      </Card>
    </div>
  );
}
