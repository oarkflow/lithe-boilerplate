import type { Signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { fmtTime } from '../../lib/api.ts';
import {
  choicesOf, display, DOCUMENT_REFS, uploadKind,
  type FormState, type Json, type PForm, type PGroup, type PInput, type PNode, type PView,
} from './formstate.ts';

/** What a screen lets the renderer do. A missing operation hides the control that needs it. */
export interface Ops {
  /** True for reviewers: shows verdict controls, work operations and notes. */
  staff: boolean;
  save(data: Json): Promise<PView>;
  act(action: string, body: Json): Promise<PView>;
  node?(node: string, verb: string, body: Json): Promise<PView>;
  work?(op: 'claim' | 'suspend' | 'resume', body: Json): Promise<PView>;
  note?(body: string, internal: boolean): Promise<PView>;
  upload?(file: File, kind: string): Promise<{ id: string; summary: string }>;
  /** Staff: fetch a document the case references, to look at it (every opening is audited). */
  document?(id: string): Promise<{ mime: string; content: string }>;
  onLiveness?(): void;
}

interface Props { st: FormState; tick: Signal<number>; busy: Signal<boolean>; ops: Ops; run: (fn: () => Promise<PView>, ok: string) => Promise<void> }

const idOf = (s: string) => `pf-${s.replace(/[^A-Za-z0-9_-]/g, '_')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
const toneOf = (s: string) => (['verified', 'approved', 'completed', 'live', 'done', 'passed'].includes(s) ? 'ok' : ['flagged', 'rejected', 'failed', 'not_live'].includes(s) ? 'error' : ['pending', 'in_progress', 'inconclusive', 'returned'].includes(s) ? 'warn' : 'neutral');
const Pill = (p: { text: string }) => <span class={`fh-badge fh-badge--${toneOf(p.text)}`}>{p.text.replace(/_/g, ' ')}</span>;

/**
 * Renders a workflow view exactly as the server describes it: the page's
 * layout, each group's mode (editable, readonly, summary, hidden), the forms
 * (snippets) inside, and for staff the review controls. Typing updates
 * `st.vals` without redrawing, so focus is never lost; structural changes
 * (a step, a row, a reload) bump `tick`.
 */
export function PipelineView(props: Props) {
  const { st, tick, busy, ops, run } = props;
  const redraw = () => { tick.value = tick.value + 1; };

  // A control that may change what else is shown (a visibility rule, a dependent
  // list) saves the draft and reloads the view so the server re-decides.
  const refresh = async () => {
    if (!st.view?.can_edit) return;
    const data = st.collect();
    if (!data) return;
    const keep = { vals: { ...st.vals }, reps: JSON.parse(JSON.stringify(st.reps)) as typeof st.reps };
    await run(() => ops.save(data), '');
    if (Object.keys(st.errs).length) { st.vals = { ...keep.vals, ...st.vals }; st.reps = keep.reps; redraw(); }
  };
  const controlling = new Set(['select', 'radio', 'boolean', 'multiselect']);

  function control(inp: PInput, path: string, val: unknown, set: (v: unknown) => void) {
    const id = idOf(path);
    const base = { id, name: path, disabled: inp.disabled || undefined, required: inp.required || undefined, 'aria-invalid': st.errorsFor(path).length ? 'true' : undefined };
    const after = () => { if (controlling.has(inp.kind)) void refresh(); };
    const choices = choicesOf(inp);
    const str = val === undefined || val === null ? '' : String(val);
    switch (inp.kind) {
      case 'textarea': return <textarea {...base} rows={3} maxlength={inp.max_length || undefined} onInput={(e: Event) => set((e.currentTarget as HTMLTextAreaElement).value)}>{str}</textarea>;
      case 'number': case 'integer':
        return <input {...base} type="number" step={inp.kind === 'integer' ? '1' : 'any'} value={str} onInput={(e: Event) => { const v = (e.currentTarget as HTMLInputElement).value; set(v === '' ? null : Number(v)); }} />;
      case 'boolean': return <input {...base} type="checkbox" checked={val === true} onChange={(e: Event) => { set((e.currentTarget as HTMLInputElement).checked ? true : (inp.required ? null : false)); after(); }} />;
      case 'date': return <input {...base} type="date" min={inp.min || undefined} max={inp.max || undefined} value={str.slice(0, 10)} onInput={(e: Event) => set((e.currentTarget as HTMLInputElement).value || null)} />;
      case 'email': return <input {...base} type="email" value={str} onInput={(e: Event) => set((e.currentTarget as HTMLInputElement).value)} />;
      case 'phone': return <input {...base} type="tel" value={str} onInput={(e: Event) => set((e.currentTarget as HTMLInputElement).value)} />;
      case 'select':
        return (
          <select {...base} onChange={(e: Event) => { set((e.currentTarget as HTMLSelectElement).value || null); after(); }}>
            <option value="">{inp.placeholder || 'Choose…'}</option>
            <For each={() => choices} key={(c: { value: string; label: string }) => c.value}>{(c: { value: string; label: string }) => <option value={String(c.value)} selected={String(c.value) === str}>{c.label || c.value}</option>}</For>
          </select>
        );
      case 'radio':
        return (
          <div role="radiogroup" class="pf-choices">
            <For each={() => choices} key={(c: { value: string; label: string }) => c.value}>
              {(c: { value: string; label: string }) => (
                <label class="pf-check"><input type="radio" name={path} value={String(c.value)} checked={String(c.value) === str} disabled={inp.disabled || undefined} onChange={() => { set(c.value); after(); }} /> {c.label || c.value}</label>
              )}
            </For>
          </div>
        );
      case 'multiselect': {
        const cur = Array.isArray(val) ? (val as unknown[]).map(String) : [];
        return (
          <div class="pf-choices">
            <For each={() => choices} key={(c: { value: string; label: string }) => c.value}>
              {(c: { value: string; label: string }) => (
                <label class="pf-check"><input type="checkbox" checked={cur.includes(String(c.value))} onChange={(e: Event) => {
                  const on = (e.currentTarget as HTMLInputElement).checked;
                  set(on ? [...cur, String(c.value)] : cur.filter((x) => x !== String(c.value)));
                  after();
                }} /> {c.label || c.value}</label>
              )}
            </For>
          </div>
        );
      }
      default:
        if (DOCUMENT_REFS.has(inp.path) && ops.upload) return documentField(inp, path, str, set);
        return <input {...base} type="text" value={str} maxlength={inp.max_length || undefined} placeholder={inp.placeholder || undefined} onInput={(e: Event) => set((e.currentTarget as HTMLInputElement).value)} />;
    }
  }

  // A document input holds the id of a file uploaded through the encrypted
  // document service; choosing a file uploads it and fills the id.
  const uploaded: Record<string, string> = {};
  const opened: Record<string, { mime: string; content: string } | 'loading' | 'error'> = {};
  function documentField(inp: PInput, path: string, current: string, set: (v: unknown) => void) {
    const form = inp.path.split('.')[0];
    const pick = async (e: Event) => {
      const f = (e.currentTarget as HTMLInputElement).files?.[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { st.notice = { kind: 'error', text: 'Files must be 10 MB or smaller.' }; redraw(); return; }
      busy.value = true;
      try {
        const r = await ops.upload!(f, uploadKind(st.vals[`${form}.kind`]));
        set(r.id); uploaded[path] = r.summary;
        st.notice = { kind: 'ok', text: `Uploaded ${f.name}. ${r.summary}` };
      } catch (err) {
        st.notice = { kind: 'error', text: err instanceof Error ? err.message : 'Upload failed' };
      } finally { busy.value = false; redraw(); }
    };
    return (
      <div class="pf-doc">
        <input type="file" id={idOf(path)} accept="image/jpeg,image/png,application/pdf" onChange={(e: Event) => void pick(e)} />
        <span class="fh-muted">{current ? `Attached (${current.slice(0, 8)}…)${uploaded[path] ? ` · ${uploaded[path]}` : ''}` : 'No file yet'}</span>
      </div>
    );
  }

  // A reviewer looks at an uploaded document inline (images) or downloads it (anything else).
  function documentViewer(inp: PInput, val: unknown) {
    if (!ops.staff || !ops.document || !DOCUMENT_REFS.has(inp.path) || typeof val !== 'string' || !val) return null;
    const key = inp.path;
    const doc = opened[key];
    const open = async () => {
      opened[key] = 'loading'; redraw();
      try { opened[key] = await ops.document!(val); } catch { opened[key] = 'error'; }
      redraw();
    };
    if (!doc) return <p><button type="button" class="fh-btn fh-btn--subtle" onClick={() => void open()}><span>View document</span></button></p>;
    if (doc === 'loading') return <p class="fh-muted">Opening…</p>;
    if (doc === 'error') return <p class="pf-err">The document could not be opened.</p>;
    const href = `data:${doc.mime};base64,${doc.content}`;
    return (
      <div class="pf-docview">
        {doc.mime.startsWith('image/') ? <img src={href} alt="Uploaded identity document" /> : <a href={href} download="document">Download the document</a>}
        <button type="button" class="fh-btn fh-btn--ghost" onClick={() => { delete opened[key]; redraw(); }}><span>Close</span></button>
      </div>
    );
  }

  function fieldEl(inp: PInput, path: string, val: unknown, editable: boolean, set: (v: unknown) => void) {
    const errs = st.errorsFor(path);
    const ed = editable && !inp.sealed && !inp.computed;
    const cls = `pf-field${inp.flag ? ' is-flagged' : ''}${errs.length ? ' is-invalid' : ''}`;
    const style = inp.span && inp.span > 1 ? `grui-column: span ${inp.span}` : undefined;
    const extras = (
      <>
        <Show when={() => Boolean(inp.verdict)}><div class="pf-note">Review: <Pill text={inp.verdict?.status ?? ''} /> {inp.verdict?.comment ?? ''}</div></Show>
        <Show when={() => Boolean(inp.flag)}><div class="pf-flag" role="note"><strong>Correction requested: </strong>{inp.flag?.comment || 'please check this field'}</div></Show>
        <For each={() => errs} key={(m: string) => m}>{(m: string) => <div class="pf-err" role="alert">{m}</div>}</For>
      </>
    );
    if (!ed) {
      return (
        <div class={cls} style={style} data-path={path}>
          <div class="pf-lbl">{inp.label}</div>
          <div class="pf-value">{display(val, inp)}{inp.masked ? <span class="fh-muted"> (masked)</span> : null}</div>
          {documentViewer(inp, val)}
          {extras}
        </div>
      );
    }
    const label = <>{inp.label}{inp.required ? <span class="pf-req" title="required"> *</span> : null}</>;
    if (inp.kind === 'boolean') {
      return <div class={cls} style={style} data-path={path}><label class="pf-check">{control(inp, path, val, set)} {label}</label>{inp.help ? <div class="pf-help">{inp.help}</div> : null}{extras}</div>;
    }
    const grouped = inp.kind === 'radio' || inp.kind === 'multiselect';
    return (
      <div class={cls} style={style} data-path={path}>
        {grouped ? <div class="pf-lbl">{label}</div> : <label class="pf-lbl" for={idOf(path)}>{label}</label>}
        {control(inp, path, val, set)}
        {inp.help ? <div class="pf-help">{inp.help}</div> : null}
        {extras}
      </div>
    );
  }

  function formEl(f: PForm, g: PGroup, hideTitle = false) {
    const cols = Math.max(1, f.columns || g.columns || 1);
    const editableGroup = g.mode === 'editable';
    const head = <>{!hideTitle && f.title ? <h4 class="pf-form-title">{f.title}</h4> : null}{f.description ? <p class="fh-muted">{f.description}</p> : null}</>;
    const grid = `--cols:${cols}`;
    if (g.mode === 'summary') {
      const dl = (get: (i: PInput) => unknown) => <dl class="pf-summary">{f.inputs.map((i) => <><dt>{i.label}</dt><dd>{display(get(i), i)}</dd></>)}</dl>;
      if (f.repeatable) return <div class="pf-form">{head}{(st.reps[f.name] ?? []).map((e) => <div class="pf-entry">{dl((i) => e[i.name])}</div>)}</div>;
      return <div class="pf-form">{head}{dl((i) => st.vals[i.path])}</div>;
    }
    if (!f.repeatable) {
      return (
        <div class="pf-form">{head}
          <div class="pf-grid" style={grid}>
            {f.inputs.map((inp) => fieldEl(inp, inp.path, st.vals[inp.path], editableGroup && inp.editable, (v) => { st.vals[inp.path] = v; st.dirty.add(inp.path); }))}
          </div>
          {f.name === 'liveness_result' && !ops.staff && ops.onLiveness ? (
            <p><button type="button" class="fh-btn fh-btn--subtle" onClick={() => ops.onLiveness?.()}><span>{st.vals['liveness_result.status'] ? 'Redo the selfie check' : 'Start the selfie check'}</span></button></p>
          ) : null}
        </div>
      );
    }
    const list = (st.reps[f.name] ??= []);
    const canEdit = editableGroup && f.inputs.some((i) => i.editable);
    const min = f.min_items || 0;
    const max = f.max_items || Infinity;
    const noun = (f.title || 'entry').toLowerCase();
    return (
      <div class="pf-form" data-path={f.name}>{head}
        {st.errorsFor(f.name).map((m) => <div class="pf-err" role="alert">{m}</div>)}
        {list.length ? null : <p class="fh-muted">No entries yet.</p>}
        {list.map((entry, i) => (
          <div class="pf-entry" role="group" aria-label={`${f.title || f.name} ${i + 1}`}>
            <div class="pf-row"><strong>#{i + 1}</strong>
              {canEdit && list.length > min ? <button type="button" class="fh-btn fh-btn--ghost" onClick={() => { list.splice(i, 1); st.dirty.add(f.name); redraw(); }}><span>Remove</span></button> : null}
            </div>
            <div class="pf-grid" style={grid}>
              {f.inputs.map((inp) => fieldEl(inp, `${f.name}.${i}.${inp.name}`, entry[inp.name], canEdit && inp.editable, (v) => { entry[inp.name] = v; st.dirty.add(f.name); }))}
            </div>
          </div>
        ))}
        {canEdit && list.length < max ? <button type="button" class="fh-btn fh-btn--subtle" onClick={() => { list.push({}); st.dirty.add(f.name); redraw(); }}><span>+ Add {noun}</span></button> : null}
        {canEdit && (min || max < Infinity) ? <div class="pf-help">{[min ? `At least ${min}` : '', max < Infinity ? `at most ${max}` : ''].filter(Boolean).join(', ')} entries.</div> : null}
      </div>
    );
  }

  interface Item { title: string; el: unknown; forms: string[]; flagged: boolean; collapsed?: boolean }

  // Arranges items in a layout; used for a page's groups and a group's forms.
  function arrange(layout: string, key: string, items: Item[], footer?: unknown) {
    const mark = (it: Item) => (st.hasIssue(it.forms, it.flagged) ? <span class="pf-dot" title="Needs attention"> •<span class="pf-sr"> needs attention</span></span> : null);
    const cur = Math.max(0, Math.min(Number(st.steps[key] ?? 0), items.length - 1));
    const go = (i: number) => { st.steps[key] = i; redraw(); };
    if (layout === 'wizard') {
      const last = cur === items.length - 1;
      return (
        <div>
          <ol class="pf-steps" aria-label="Steps">{items.map((it, i) => <li aria-current={i === cur ? 'step' : undefined} class={i < cur ? 'is-done' : ''}>{i + 1}. {it.title}{mark(it)}</li>)}</ol>
          <section aria-label={`Step ${cur + 1} of ${items.length}`}>{items[cur].title ? <h3 class="pf-section">{items[cur].title}</h3> : null}{items[cur].el}</section>
          <div class="pf-bar">
            <div class="pf-row">
              <button type="button" class="fh-btn fh-btn--ghost" disabled={cur === 0} onClick={() => go(cur - 1)}><span>Back</span></button>
              {last ? null : <button type="button" class="fh-btn fh-btn--primary" onClick={() => go(cur + 1)}><span>Next</span></button>}
            </div>
            <span class="fh-muted">Step {cur + 1} of {items.length}</span>
          </div>
          {last ? footer : null}
        </div>
      );
    }
    let body: unknown;
    if (layout === 'tabbed') {
      body = (
        <div>
          <div class="pf-tabs" role="tablist">{items.map((it, i) => <button type="button" role="tab" aria-selected={i === cur ? 'true' : 'false'} class={i === cur ? 'is-active' : ''} onClick={() => go(i)}>{it.title}{mark(it)}</button>)}</div>
          <div role="tabpanel">{items[cur].el}</div>
        </div>
      );
    } else if (layout === 'accordion') {
      body = (
        <div>{items.map((it, i) => {
          const k = `${key}_${i}`;
          const open = k in st.steps ? Boolean(st.steps[k]) : !it.collapsed;
          return <details class="pf-acc" open={open} onToggle={(e: Event) => { st.steps[k] = (e.currentTarget as HTMLDetailsElement).open; }}><summary>{it.title}{mark(it)}</summary><div>{it.el}</div></details>;
        })}</div>
      );
    } else if (layout === 'grid') {
      body = <div class="pf-cards">{items.map((it) => <section class="pf-card">{it.title ? <h3 class="pf-section">{it.title}{mark(it)}</h3> : null}{it.el}</section>)}</div>;
    } else {
      body = <div class="pf-stack">{items.map((it) => <section>{it.title ? <h3 class="pf-section">{it.title}{mark(it)}</h3> : null}{it.el}</section>)}</div>;
    }
    return <div>{body}{footer}</div>;
  }

  function groupEl(g: PGroup) {
    const desc = g.description ? <p class="fh-muted">{g.description}</p> : null;
    if (['tabbed', 'accordion', 'wizard', 'grid'].includes(g.layout) && g.forms.length > 1) {
      const items: Item[] = g.forms.map((f) => ({ title: f.title || f.name, forms: [f.name], flagged: f.inputs.some((i) => Boolean(i.flag)), el: formEl(f, g, true) }));
      return <div>{desc}{arrange(g.layout, `g_${g.name}`, items)}</div>;
    }
    return <div>{desc}{g.forms.map((f) => formEl(f, g))}</div>;
  }

  const infoEl = (before: string) =>
    (st.view?.page?.info ?? []).filter((i) => (i.before ?? '') === before).map((i) => (
      <aside class={`pf-info pf-info--${i.style || 'info'}`}>{i.title ? <strong>{i.title}</strong> : null}<p>{i.body}</p></aside>
    ));

  const acksEl = () =>
    (st.view?.page?.acknowledgements ?? []).map((a) => (
      <div class="pf-field" data-path={`acknowledgements.${a.name}`}>
        <label class="pf-check"><input type="checkbox" checked={Boolean(st.acks[a.name])} onChange={(e: Event) => { st.acks[a.name] = (e.currentTarget as HTMLInputElement).checked; }} /> {a.text}</label>
        {st.errorsFor(`acknowledgements.${a.name}`).map((m) => <div class="pf-err" role="alert">{m}</div>)}
      </div>
    ));

  function actionBar() {
    const v = st.view!;
    const acts = v.actions ?? [];
    if (!v.can_edit && !acts.length) return null;
    const needs = acts.filter((a) => a.comment_required).map((a) => a.label);
    const submits = acts.some((a) => ['advance', 'approve'].includes(a.outcome));
    const go = (a: NonNullable<PView['actions']>[number]) => {
      const comment = st.comment.trim();
      if (a.comment_required && !comment) { st.errs = { comment: [`A comment is required to ${a.label}.`] }; redraw(); return; }
      if (a.confirm && !window.confirm(a.confirm)) return;
      const body: Json = {};
      if (ops.staff && a.outcome === 'return') {
        // Flags marked in the check blocks travel with the return. Without any, the
        // person could not change a thing, so say so before sending.
        const flags: Record<string, string> = {};
        for (const node of Object.values(st.verdicts)) {
          for (const [path, x] of Object.entries(node)) if (x.status === 'flagged') flags[path] = x.comment || comment;
        }
        const already = (v.corrections ?? []).length > 0;
        if (!Object.keys(flags).length && !already && !window.confirm('No field is flagged, so the person will not be able to change anything. Send the request anyway?')) return;
        if (Object.keys(flags).length) body.flags = flags;
      }
      if (comment) body.comment = comment;
      const data = st.collect();
      if (data) body.data = data;
      if (submits && ['advance', 'approve'].includes(a.outcome)) body.acknowledgements = st.ackBody();
      void run(() => ops.act(a.name, body), `${a.label}: done.`);
    };
    return (
      <div class="pf-bar pf-bar--actions">
        {submits ? <div class="pf-full">{acksEl()}</div> : null}
        {acts.length ? (
          <div class="pf-field pf-full" data-path="comment">
            <label class="pf-lbl" for="pf-comment">Comment <span class="fh-muted">{needs.length ? `(required to ${needs.join(', ')})` : '(optional)'}</span></label>
            <textarea id="pf-comment" rows={2} onInput={(e: Event) => { st.comment = (e.currentTarget as HTMLTextAreaElement).value; }}>{st.comment}</textarea>
            {st.errorsFor('comment').map((m) => <div class="pf-err" role="alert">{m}</div>)}
          </div>
        ) : null}
        {v.can_edit ? <button type="button" class="fh-btn fh-btn--ghost" disabled={busy.value} onClick={() => { const d = st.collect(); void run(() => ops.save(d ?? {}), 'Draft saved.'); }}><span>Save draft</span></button> : <span />}
        <div class="pf-row pf-end">{acts.map((a) => (
          <button type="button" disabled={busy.value} class={`fh-btn ${['reject', 'withdraw'].includes(a.outcome) ? 'fh-btn--danger' : a.outcome === 'advance' ? 'fh-btn--primary' : 'fh-btn--subtle'}`} onClick={() => go(a)}><span>{a.label}</span></button>
        ))}</div>
      </div>
    );
  }

  // ---- staff: nodes (checks and sign-offs), work operations and notes ----
  function nodeEl(n: PNode) {
    const nodeOps = n.operations ?? [];
    const inState = (st.nodeIn[n.name] ??= { comment: '', result: '' });
    const rows = n.kind === 'review' && nodeOps.includes('verify') ? st.reviewInputs(n) : [];
    const vd = (st.verdicts[n.name] ??= {});
    const send = (verb: string, extra: Json = {}) => {
      const body: Json = { ...extra };
      if (inState.comment.trim()) body.comment = inState.comment.trim();
      void run(() => ops.node!(n.name, verb, body), `${n.title || n.name}: ${verb} done.`);
    };
    const onOp = (op: string) => {
      if (op === 'verify') return send('verify', { verdicts: st.verdictBody(n.name) });
      if (['waive', 'reject', 'fail'].includes(op) && !window.confirm(`${cap(op)} "${n.title || n.name}"?`)) return;
      if (op === 'reject' && !inState.comment.trim()) { st.errs = { [`node:${n.name}`]: ['Say why you reject.'] }; redraw(); return; }
      send(op);
    };
    return (
      <div class="pf-node">
        <div class="pf-row"><h4 class="pf-form-title">{n.title || n.name}</h4><span class="fh-badge fh-badge--neutral">{n.kind}</span>{n.optional ? <span class="fh-badge fh-badge--neutral">optional</span> : null}<Pill text={n.status} /></div>
        {n.description ? <p class="fh-muted">{n.description}</p> : null}
        {n.kind === 'approval' ? <p class="fh-muted">Approvals: {(n.approvals ?? []).length} of {n.required_approvals || 1}</p> : null}
        {(n.approvals ?? []).map((a) => <div class="pf-note">Approved by {a.by} · {fmtTime(a.at)}{a.comment ? ` · ${a.comment}` : ''}</div>)}
        {n.comment ? <p><strong>Comment: </strong>{n.comment}</p> : null}
        {rows.length ? (
          <div role="group" aria-label={`Field verdicts for ${n.title || n.name}`}>{rows.map((inp) => {
            const x = (vd[inp.path] ??= { status: '', comment: '' });
            return (
              <div class="pf-verdict">
                <div><div class="pf-lbl">{inp.label}</div><div class="fh-muted">{display(st.vals[inp.path], inp)}</div></div>
                <div class="pf-seg" role="radiogroup" aria-label={`Verdict for ${inp.label}`}>
                  {[['', 'Unset'], ['verified', 'Verified'], ['flagged', 'Flag']].map(([val, l]) => (
                    <label><input type="radio" name={idOf(`${n.name}-${inp.path}`)} value={val} checked={x.status === val} onChange={() => { x.status = val; redraw(); }} /> {l}</label>
                  ))}
                </div>
                {x.status === 'flagged' ? <input type="text" aria-label={`What is wrong with ${inp.label}`} placeholder="What is wrong? (shown to the person)" value={x.comment} onInput={(e: Event) => { x.comment = (e.currentTarget as HTMLInputElement).value; }} /> : null}
              </div>
            );
          })}</div>
        ) : null}
        {nodeOps.length ? (
          <div class="pf-stack">
            <div class="pf-field"><label class="pf-lbl" for={idOf(`nc-${n.name}`)}>Comment</label>
              <input id={idOf(`nc-${n.name}`)} type="text" value={inState.comment} onInput={(e: Event) => { inState.comment = (e.currentTarget as HTMLInputElement).value; }} />
              {st.errorsFor(`node:${n.name}`).map((m) => <div class="pf-err" role="alert">{m}</div>)}
            </div>
            <div class="pf-row">{nodeOps.map((op) => (
              <button type="button" disabled={busy.value} class={`fh-btn ${['reject', 'fail'].includes(op) ? 'fh-btn--danger' : ['approve', 'complete', 'issue', 'run'].includes(op) ? 'fh-btn--primary' : 'fh-btn--subtle'}`} onClick={() => onOp(op)}><span>{op === 'verify' ? 'Save verdicts' : cap(op)}</span></button>
            ))}</div>
          </div>
        ) : null}
      </div>
    );
  }

  const workState = { reason: '', note: '', internal: true };
  function workEl() {
    const w = st.view?.work;
    if (!ops.staff || !w || !ops.work) return null;
    const wops = w.operations ?? [];
    return (
      <section class="pf-card">
        <h3 class="pf-section">Work</h3>
        <p class="fh-muted">{w.assignee ? `Held by ${w.assignee.slice(0, 8)}` : 'Unassigned'}{w.sla?.due_at ? ` · due ${fmtTime(w.sla.due_at)}` : ''}</p>
        {w.suspended ? <aside class="pf-info pf-info--warning"><strong>On hold</strong><p>{w.suspended.reason || 'No reason given'}</p></aside> : null}
        <div class="pf-row">
          {wops.includes('claim') ? <button type="button" class="fh-btn fh-btn--subtle" disabled={busy.value} onClick={() => void run(() => ops.work!('claim', {}), 'Claimed.')}><span>Claim</span></button> : null}
          {wops.includes('resume') ? <button type="button" class="fh-btn fh-btn--primary" disabled={busy.value} onClick={() => void run(() => ops.work!('resume', { comment: workState.reason }), 'Resumed.')}><span>Resume</span></button> : null}
          {wops.includes('suspend') ? <button type="button" class="fh-btn fh-btn--ghost" disabled={busy.value} onClick={() => {
            if (!workState.reason.trim()) { st.errs = { 'work:reason': ['Say why the case is on hold.'] }; redraw(); return; }
            void run(() => ops.work!('suspend', { comment: workState.reason }), 'Put on hold.');
          }}><span>Put on hold</span></button> : null}
        </div>
        {wops.includes('suspend') || wops.includes('resume') ? (
          <div class="pf-field"><label class="pf-lbl" for="pf-hold">Reason</label>
            <input id="pf-hold" type="text" value={workState.reason} onInput={(e: Event) => { workState.reason = (e.currentTarget as HTMLInputElement).value; }} />
            {st.errorsFor('work:reason').map((m) => <div class="pf-err" role="alert">{m}</div>)}
          </div>
        ) : null}
      </section>
    );
  }

  function notesEl() {
    if (!ops.staff || !ops.note) return null;
    const list = st.view?.notes ?? [];
    return (
      <section class="pf-card">
        <h3 class="pf-section">Notes</h3>
        {list.length ? list.map((n) => <div class="pf-note"><strong>{n.by.slice(0, 8)}</strong> · {fmtTime(n.at)}{n.internal ? ' · internal' : ''}<p>{n.body}</p></div>) : <p class="fh-muted">No notes yet.</p>}
        <div class="pf-field"><label class="pf-lbl" for="pf-note">Add a note</label>
          <textarea id="pf-note" rows={2} onInput={(e: Event) => { workState.note = (e.currentTarget as HTMLTextAreaElement).value; }}>{workState.note}</textarea></div>
        <label class="pf-check"><input type="checkbox" checked={workState.internal} onChange={(e: Event) => { workState.internal = (e.currentTarget as HTMLInputElement).checked; }} /> Internal (staff only)</label>
        <p><button type="button" class="fh-btn fh-btn--subtle" disabled={busy.value} onClick={() => {
          if (!workState.note.trim()) return;
          const body = workState.note;
          workState.note = '';
          void run(() => ops.note!(body, workState.internal), 'Note added.');
        }}><span>Add note</span></button></p>
      </section>
    );
  }

  function page() {
    const v = st.view;
    if (!v) return null;
    const pg = v.page;
    const n = st.notice;
    return (
      <div class="pf">
        <Show when={() => Boolean(v.progress?.length)}>
          <ol class="pf-progress" aria-label="Progress">{(v.progress ?? []).map((p) => <li class={`is-${p.status}`} aria-current={p.name === v.case.stage ? 'step' : undefined}>{p.title || p.name}</li>)}</ol>
        </Show>
        {n ? <div class={`pf-notice pf-notice--${n.kind}`} role="status">{n.text}{n.list?.length ? <ul>{n.list.map((m) => <li>{m}</li>)}</ul> : null}</div> : null}
        {(v.corrections ?? []).length ? <aside class="pf-info pf-info--warning"><strong>Corrections requested</strong><ul>{(v.corrections ?? []).map((c) => <li>{st.label(c.path)}: {c.comment || 'please check'}</li>)}</ul></aside> : null}
        {pg ? (
          <>
            {pg.description ? <p class="fh-muted">{pg.description}</p> : null}
            {infoEl('')}
            {arrange(pg.layout || 'stacked', 'page', pg.groups.filter((g) => g.mode !== 'hidden').map((g) => ({
              title: g.title || g.name, forms: g.forms.map((f) => f.name), flagged: g.forms.some((f) => f.inputs.some((i) => Boolean(i.flag))), collapsed: g.collapsed,
              el: <>{infoEl(g.name)}{groupEl(g)}</>,
            })))}
          </>
        ) : <p class="fh-muted">This case is waiting at a step you do not work on.</p>}
        {(v.nodes ?? []).length ? <section class="pf-card"><h3 class="pf-section">Checks</h3>{(v.nodes ?? []).map((nd) => nodeEl(nd))}</section> : null}
        {workEl()}
        {actionBar()}
        {notesEl()}
        {(v.certificates ?? []).length ? <aside class="pf-info pf-info--success"><strong>Verification certificate</strong><p>{(v.certificates ?? []).map((c) => c.number || c.id).join(', ')}</p></aside> : null}
      </div>
    );
  }

  return <>{() => { void tick.value; void busy.value; return page(); }}</>;
}
