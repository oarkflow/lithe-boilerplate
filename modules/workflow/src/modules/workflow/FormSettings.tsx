import { onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Alert } from '../../components/ui/Alert.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, attempt, fmtTime, resource } from '../../lib/api.ts';
import type { Json } from '../../lib/secure-client.ts';
import { ApiError } from '../../lib/types.ts';
import { Status } from '../../ui/bits.tsx';

interface FieldOv { label?: string; required?: boolean; hidden?: boolean; disabled?: boolean }
interface StageOv { sla_duration?: string; sla_warn_before?: string }
interface Settings { fields: Record<string, FieldOv>; stages: Record<string, StageOv> }

/** Which workflow's forms are being tuned: people's identity (kyc) or businesses (kyb). */
const workflow = signal<'kyc' | 'kyb'>('kyc');

/**
 * Tune the verification forms for your organisation: rename fields, make an
 * optional one required, hide an optional one, set review deadlines. Settings
 * can only tighten a workflow: required data cannot be hidden or made
 * optional, and fields filled in by the system cannot be touched. Every change
 * is kept as a revision and can be restored.
 */
export function FormSettings() {
  const wf = resource(() => api.get(`/admin/forms/${workflow.value}`));
  const history = resource(() => api.get(`/admin/forms/${workflow.value}/history`));
  const totp = signal('');
  const note = signal('');
  const problems = signal([] as string[]);
  const saving = signal(false);
  const working = signal<Settings>({ fields: {}, stages: {} });
  const tick = signal(0);

  const load = async () => {
    await wf.reload();
    const s = (wf.data.value?.settings as Json | undefined) ?? {};
    working.value = { fields: { ...((s.fields as Record<string, FieldOv>) ?? {}) }, stages: { ...((s.stages as Record<string, StageOv>) ?? {}) } };
    problems.value = [];
    tick.value = tick.value + 1;
    void history.reload();
  };
  onMount(() => { void load(); });
  const choose = (w: 'kyc' | 'kyb') => { workflow.value = w; preview.value = undefined; void load(); };
  const preview = signal<Json | undefined>(undefined);
  /** Show the applicant's form with these settings applied, without saving. */
  async function showPreview() {
    const out = await attempt(() => api.post(`/admin/forms/${workflow.value}/preview`, { settings: clean() }));
    if (out) preview.value = out;
  }
  const previewRows = (): Json[] => {
    const rows: Json[] = [];
    const groups = ((preview.value?.page as Json | undefined)?.groups as Json[] | undefined) ?? [];
    for (const g of groups) for (const f of (g.forms as Json[] | undefined) ?? []) for (const i of (f.inputs as Json[] | undefined) ?? []) rows.push({ group: g.title, form: f.title || f.name, label: i.label || i.name, required: i.required, disabled: i.disabled });
    return rows;
  };

  const forms = () => ((wf.data.value?.workflow as Json | undefined)?.forms as Json[] | undefined) ?? [];
  const stages = () => ((wf.data.value?.workflow as Json | undefined)?.stages as Json[] | undefined) ?? [];
  const fld = (k: string): FieldOv => (working.value.fields[k] ??= {});
  const clean = (): Settings => {
    const fields: Record<string, FieldOv> = {};
    for (const [k, v] of Object.entries(working.value.fields)) {
      const o: FieldOv = {};
      if (v.label?.trim()) o.label = v.label.trim();
      if (v.required) o.required = true;
      if (v.hidden) o.hidden = true;
      if (v.disabled) o.disabled = true;
      if (Object.keys(o).length) fields[k] = o;
    }
    const st: Record<string, StageOv> = {};
    for (const [k, v] of Object.entries(working.value.stages)) {
      const o: StageOv = {};
      if (v.sla_duration?.trim()) o.sla_duration = v.sla_duration.trim();
      if (v.sla_warn_before?.trim()) o.sla_warn_before = v.sla_warn_before.trim();
      if (Object.keys(o).length) st[k] = o;
    }
    return { fields, stages: st };
  };

  async function check() {
    const out = await attempt(() => api.post(`/admin/forms/${workflow.value}/check`, { settings: clean() }));
    if (out) problems.value = (out.problems as string[]) ?? [];
  }
  async function save() {
    if (!/^\d{6}$/.test(totp.value.trim())) { window.alert('Enter your current 6-digit authenticator code first.'); return; }
    saving.value = true;
    problems.value = [];
    try {
      await api.put(`/admin/forms/${workflow.value}`, { settings: clean(), note: note.value, totp: totp.value.trim() });
      await load();
      window.alert('Saved. People see the change on their next screen.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) problems.value = e.detail ? [e.detail] : ['Those settings are not allowed.'];
      else await attempt(async () => { throw e; });
    } finally { saving.value = false; }
  }
  async function restore(rev: number) {
    if (!/^\d{6}$/.test(totp.value.trim())) { window.alert('Enter your current 6-digit authenticator code first.'); return; }
    if (window.confirm(`Restore the settings from revision ${rev}?`) && await attempt(() => api.post(`/admin/forms/${workflow.value}/rollback`, { rev, totp: totp.value.trim() }), `Restored revision ${rev}`)) void load();
  }

  return (
    <div class="fh-panels">
      <Card eyebrow="Organisation settings" title={() => `Forms: ${String((wf.data.value?.workflow as Json | undefined)?.title ?? workflow.value)}`}
        actions={<><Button variant={() => (workflow.value === 'kyc' ? 'primary' : 'ghost')} onClick={() => choose('kyc')}>People</Button><Button variant={() => (workflow.value === 'kyb' ? 'primary' : 'ghost')} onClick={() => choose('kyb')}>Businesses</Button><Button variant="ghost" onClick={() => void check()}>Check</Button><Button variant="subtle" onClick={() => void showPreview()}>Preview</Button><Button busy={saving} onClick={() => void save()}>Save</Button></>}>
        <Status r={wf as never} />
        <Alert tone="info">These settings apply only to your organisation. They can tighten a form, never loosen it: required details stay required, and results written by the system stay locked.</Alert>
        <Show when={() => problems.value.length > 0}>
          <Alert tone="error">{() => problems.value.join(' · ')}</Alert>
        </Show>
        <div class="fh-form ui-grid">
          <label class="fh-field"><span>Authenticator code</span><input inputmode="numeric" maxlength="6" autocomplete="one-time-code" onInput={(e: Event) => { totp.value = (e.currentTarget as HTMLInputElement).value; }} /></label>
          <label class="fh-field"><span>Why? (kept in the history)</span><input maxlength="200" onInput={(e: Event) => { note.value = (e.currentTarget as HTMLInputElement).value; }} /></label>
        </div>
      </Card>

      <Show when={() => Boolean(preview.value)}>
        <Card eyebrow="Preview" title="What the applicant would see" actions={<Button variant="ghost" onClick={() => { preview.value = undefined; }}>Close</Button>}>
          <p class="fh-auth-card__lede">This is the first step of the application with the settings above applied. Nothing has been saved.</p>
          <table class="ui-table"><thead><tr><th>Section</th><th>Form</th><th>Field</th><th>Required</th></tr></thead><tbody>
            <For each={previewRows} key={(r: Json) => `${r.group}${r.form}${r.label}`} fallback={<tr><td colSpan={4} class="fh-muted">Nothing is shown to the applicant on this step.</td></tr>}>
              {(r: Json) => <tr><td>{String(r.group ?? '')}</td><td>{String(r.form)}</td><td>{String(r.label)}</td><td>{r.required ? 'yes' : 'no'}</td></tr>}
            </For></tbody></table>
        </Card>
      </Show>

      {() => {
        void tick.value;
        return forms().map((f) => {
          const locked = Boolean(f.system);
          const fInputs = (f.inputs as Json[] | undefined) ?? [];
          const hasRequired = fInputs.some((i) => Boolean(i.required));
          return (
            <Card eyebrow={locked ? 'Written by the system' : 'Form'} title={String(f.title || f.name)}>
              <label class="ui-check"><input type="checkbox" disabled={locked || hasRequired} checked={Boolean(fld(String(f.name)).hidden)}
                onChange={(e: Event) => { fld(String(f.name)).hidden = (e.currentTarget as HTMLInputElement).checked; }} /> Hide this whole form{hasRequired ? ' (not allowed: it has required fields)' : locked ? ' (not allowed)' : ''}</label>
              <table class="ui-table"><thead><tr><th>Field</th><th>Your wording</th><th>Required</th><th>Hidden</th></tr></thead><tbody>
                {fInputs.map((i) => {
                  const k = `${f.name}.${i.name}`;
                  const o = fld(k);
                  return (
                    <tr>
                      <td>{String(i.label || i.name)} <code>{String(i.name)}</code>{i.sensitive ? ' 🔒' : ''}</td>
                      <td><input disabled={locked} value={o.label ?? ''} maxlength="120" placeholder={String(i.label || '')} onInput={(e: Event) => { o.label = (e.currentTarget as HTMLInputElement).value; }} /></td>
                      <td><input type="checkbox" checked={Boolean(i.required) || Boolean(o.required)} disabled={locked || Boolean(i.required)} title={i.required ? 'Always required' : ''}
                        onChange={(e: Event) => { o.required = (e.currentTarget as HTMLInputElement).checked; }} /></td>
                      <td><input type="checkbox" checked={Boolean(o.hidden)} disabled={locked || Boolean(i.required)} title={i.required ? 'Required data cannot be hidden' : ''}
                        onChange={(e: Event) => { o.hidden = (e.currentTarget as HTMLInputElement).checked; }} /></td>
                    </tr>
                  );
                })}
              </tbody></table>
            </Card>
          );
        });
      }}

      <Card eyebrow="Timing" title="Review deadlines">
        <table class="ui-table"><thead><tr><th>Step</th><th>Default</th><th>Deadline (e.g. 2d, 8h)</th><th>Warn before</th></tr></thead><tbody>
          <For each={() => stages().filter((s) => Boolean(s.hasSla))} key={(s: Json) => s.name}>
            {(s: Json) => {
              const o = (working.value.stages[String(s.name)] ??= {});
              return (
                <tr><td>{String(s.title || s.name)}</td><td>{String(s.duration ?? '')}{s.warnBefore ? ` (warn ${s.warnBefore})` : ''}</td>
                  <td><input value={o.sla_duration ?? ''} placeholder={String(s.duration ?? '')} onInput={(e: Event) => { o.sla_duration = (e.currentTarget as HTMLInputElement).value; }} /></td>
                  <td><input value={o.sla_warn_before ?? ''} placeholder={String(s.warnBefore ?? '')} onInput={(e: Event) => { o.sla_warn_before = (e.currentTarget as HTMLInputElement).value; }} /></td></tr>
              );
            }}
          </For>
        </tbody></table>
      </Card>

      <Card eyebrow="Change history" title="Revisions">
        <table class="ui-table"><thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th /></tr></thead><tbody>
          <For each={() => (history.data.value?.revisions as Json[] | undefined) ?? []} key={(h: Json) => h.rev} fallback={<tr><td colSpan={5} class="fh-muted">No changes yet: the standard forms are in use.</td></tr>}>
            {(h: Json) => <tr><td>{h.rev}</td><td>{fmtTime(String(h.at))}</td><td>{String(h.author).slice(0, 10)}</td><td>{h.note}</td><td><Button variant="ghost" onClick={() => void restore(Number(h.rev))}>Restore</Button></td></tr>}
          </For>
        </tbody></table>
      </Card>
    </div>
  );
}
