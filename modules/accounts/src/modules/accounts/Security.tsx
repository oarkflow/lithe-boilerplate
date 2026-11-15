import { onMount, signal } from '@oarkflow/lithe/core';
import { Show } from '@oarkflow/lithe/dom';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, attempt, formData, resource } from '../../lib/api.ts';
import type { Json } from '../../lib/secure-client.ts';
import { Kv, Status } from '../../ui/bits.tsx';
import { qrSvg } from './qr.ts';

/** The signed-in person's own account: authenticator app (TOTP) and password. */
export function Security() {
  const me = resource(() => api.get('/account'));
  const setup = signal<Json | undefined>(undefined);
  onMount(() => { void me.reload(); });
  const info = (): Json => me.data.value ?? {};

  async function begin() {
    const out = await attempt(() => api.post('/account/totp/begin'));
    if (!out) return;
    setup.value = out;
    document.getElementById('ui-totp-qr')?.replaceChildren(qrSvg(String(out.uri), 200));
  }
  async function confirm(e: Event) {
    const f = formData(e);
    if (await attempt(() => api.post('/account/totp/confirm', { code: f.code }), 'Authenticator enabled')) { setup.value = undefined; void me.reload(); }
  }
  async function changePassword(e: Event) {
    const f = formData(e);
    if (await attempt(() => api.post('/account/password', { current: f.current, next: f.next }), 'Password changed')) (e.currentTarget as HTMLFormElement).reset();
  }
  return (
    <div class="fh-panels">
      <Card eyebrow="Account" title="Who you are">
        <Status r={me as never} />
        <dl class="ui-kvs">
          <Kv k="Name" v={() => String(info().name ?? '—')} />
          <Kv k="Roles" v={() => ((info().roles as string[] | undefined) ?? []).join(', ') || '—'} />
          <Kv k="Organisation" v={() => String(info().tenant ?? '—')} />
        </dl>
      </Card>
      <Show when={() => Boolean(info().builtin)}>
        <Card eyebrow="Two-step sign-in" title="Authenticator app">
          <dl class="ui-kvs"><Kv k="Status" v={() => (info().totpEnabled ? <Badge tone="ok" dot>Enabled</Badge> : <Badge tone="warn" dot>Not enabled</Badge>)} /></dl>
          <p class="fh-auth-card__lede">Required for sensitive actions such as changing access, and for sign-in once enabled.</p>
          <Show when={() => !setup.value}><Button onClick={() => void begin()}>{() => (info().totpEnabled ? 'Replace authenticator' : 'Set up authenticator')}</Button></Show>
          <Show when={() => Boolean(setup.value)}>
            <div class="ui-qrwrap"><div id="ui-totp-qr" /></div>
            <p class="fh-muted">Scan with your authenticator app, or enter this key: <code class="fh-code">{() => String(setup.value?.secret ?? '')}</code></p>
            <form class="fh-form" onSubmit={confirm}>
              <label class="fh-field"><span>Code from the app</span><input name="code" inputmode="numeric" maxlength="6" required /></label>
              <Button type="submit" class="fh-form__submit">Confirm</Button>
            </form>
          </Show>
        </Card>
        <Card eyebrow="Password" title="Change password">
          <form class="fh-form ui-grid" onSubmit={changePassword}>
            <label class="fh-field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required /></label>
            <label class="fh-field"><span>New password</span><input name="next" type="password" autocomplete="new-password" required /></label>
            <Button type="submit" class="fh-form__submit">Change password</Button>
          </form>
        </Card>
      </Show>
    </div>
  );
}
