// Pure state and rules for rendering a workflow view (no UI framework): what
// the server sent, what the person has typed, what to send back, and which
// error belongs to which input. Keeping it free of the DOM makes it testable.

export type Json = Record<string, unknown>;
export interface FieldError { path: string; rule?: string; message: string }
export interface Choice { value: string; label: string }

export interface PInput {
  name: string; path: string; label: string; kind: string;
  help?: string; placeholder?: string; required?: boolean; editable: boolean; disabled?: boolean;
  depends_on?: string[]; options?: string[]; choices?: Choice[]; lookup?: string;
  pattern?: string; min_length?: number; max_length?: number; min?: string; max?: string;
  accept?: string[]; span?: number; value?: unknown; masked?: boolean; sealed?: boolean; computed?: boolean;
  flag?: { comment?: string }; verdict?: { status: string; comment?: string };
}
export interface PForm {
  name: string; title?: string; description?: string; repeatable?: boolean;
  min_items?: number; max_items?: number; columns?: number; inputs: PInput[]; entries?: Json[];
}
export interface PGroup {
  name: string; title?: string; description?: string; mode: string; layout: string;
  columns?: number; collapsed?: boolean; forms: PForm[];
}
export interface PInfo { name: string; title?: string; body: string; style: string; before?: string }
export interface PAck { name: string; title?: string; text: string; sha256: string; before?: string; accepted?: unknown }
export interface PNode {
  name: string; title?: string; kind: string; status: string; optional?: boolean;
  approvals?: Array<{ by: string; at: string; decision?: string; comment?: string }>;
  required_approvals?: number; comment?: string; result?: unknown; forms?: string[]; operations?: string[]; description?: string;
}
export interface PAction { name: string; label: string; outcome: string; comment_required?: boolean; confirm?: string }
export interface PView {
  case: { id: string; number?: string; status: string; stage: string; revision?: number; title?: string };
  stage?: { name: string; title?: string; status: string; current: boolean; description?: string };
  progress?: Array<{ name: string; title?: string; status: string }>;
  page?: { title?: string; description?: string; layout: string; submit_label?: string; groups: PGroup[]; info?: PInfo[]; acknowledgements?: PAck[] };
  nodes?: PNode[]; actions?: PAction[]; can_edit?: boolean; corrections?: Array<{ path: string; comment?: string }>;
  certificates?: Array<{ number?: string; id?: string }>;
  work?: { claimable?: boolean; assignee?: string; suspended?: { reason?: string }; operations?: string[]; sla?: { due_at?: string; breached?: boolean } };
  notes?: Array<{ id: string; by: string; at: string; body: string; internal?: boolean }>;
}

export interface Verdict { status: string; comment: string }

export function choicesOf(inp: PInput): Choice[] {
  if (inp.choices && inp.choices.length) return inp.choices;
  return (inp.options ?? []).map((o) => ({ value: o, label: o }));
}

/** How a stored value reads to a person (labels for choices, Yes/No, masked). */
export function display(val: unknown, inp: PInput): string {
  if (val === undefined || val === null || val === '') return '—';
  const label = (x: unknown) => choicesOf(inp).find((c) => String(c.value) === String(x))?.label ?? String(x);
  if (inp.kind === 'boolean') return val === true ? 'Yes' : val === false ? 'No' : '—';
  if (inp.kind === 'multiselect' && Array.isArray(val)) return val.map(label).join(', ') || '—';
  if (inp.kind === 'select' || inp.kind === 'radio') return label(val);
  if (inp.kind === 'file' && typeof val === 'object' && val !== null) return String((val as Json).name ?? 'file');
  return String(val);
}

/** Which inputs hold the id of an uploaded document (the server checks ownership). */
export const DOCUMENT_REFS = new Set(['documents.front', 'documents.back', 'documents.registration', 'documents.tax', 'documents.other']);

/** The upload `kind` the document service knows for a form's chosen document type. */
export function uploadKind(formKind: unknown): string {
  switch (String(formKind ?? '')) {
    case 'driving_licence': return 'drivers_license';
    case 'citizenship': case 'national_id': return 'national_id';
    case 'passport': return 'passport';
    default: return 'other';
  }
}

export class FormState {
  view?: PView;
  vals: Record<string, unknown> = {};
  reps: Record<string, Json[]> = {};
  dirty = new Set<string>();
  errs: Record<string, string[]> = {};
  steps: Record<string, number | boolean> = {};
  verdicts: Record<string, Record<string, Verdict>> = {};
  nodeIn: Record<string, { comment: string; result: string }> = {};
  acks: Record<string, boolean> = {};
  comment = '';
  notice?: { kind: 'ok' | 'warn' | 'error'; text: string; list?: string[] };
  private key = '';

  *inputs(): Generator<{ inp: PInput; f: PForm; g: PGroup }> {
    for (const g of this.view?.page?.groups ?? []) for (const f of g.forms ?? []) for (const inp of f.inputs ?? []) yield { inp, f, g };
  }

  /** Takes a fresh view from the server and resets everything derived from it. */
  apply(v: PView): void {
    const key = `${v.case.id}/${v.stage?.name ?? ''}`;
    if (key !== this.key) { this.steps = {}; this.key = key; }
    this.view = v;
    this.vals = {}; this.reps = {}; this.dirty = new Set(); this.verdicts = {}; this.nodeIn = {}; this.comment = ''; this.acks = {};
    if (!v.stage) return;
    const seen: Record<string, boolean> = {};
    for (const { inp, f } of this.inputs()) {
      // A form shown in several groups keeps the editable rendering's value.
      if (!seen[inp.path] || inp.editable) { this.vals[inp.path] = inp.value; seen[inp.path] = true; }
      if (f.repeatable && !this.reps[f.name]) this.reps[f.name] = (f.entries ?? []).map((e) => ({ ...e }));
      if (inp.verdict) {
        for (const n of v.nodes ?? []) {
          if ((n.forms ?? []).includes(f.name)) {
            (this.verdicts[n.name] ??= {})[inp.path] = { status: inp.verdict.status, comment: inp.verdict.comment ?? '' };
          }
        }
      }
    }
  }

  label(path: string): string {
    for (const { inp } of this.inputs()) if (inp.path === path) return inp.label;
    return path;
  }

  /** What to send back: only editable inputs of editable groups, never a masked placeholder. */
  collect(): Json | null {
    const data: Json = {};
    let any = false;
    for (const { inp, f, g } of this.inputs()) {
      if (g.mode !== 'editable' || !inp.editable || inp.computed || inp.sealed) continue;
      any = true;
      if (f.repeatable) {
        data[f.name] = (this.reps[f.name] ?? []).map((e) => {
          const o: Json = {};
          for (const i of f.inputs) if (i.editable && !i.computed && !i.sealed && e[i.name] !== undefined) o[i.name] = e[i.name];
          return o;
        });
        continue;
      }
      if (inp.masked && !this.dirty.has(inp.path)) continue; // never echo a masked placeholder
      const v = this.vals[inp.path];
      ((data[f.name] ??= {}) as Json)[inp.name] = v === undefined ? null : v;
    }
    return any ? data : null;
  }

  /** Files each error under the input path it names. */
  setErrors(fields: FieldError[], prefix = ''): void {
    for (const d of fields) (this.errs[prefix + d.path] ??= []).push(d.message);
  }

  clearErrors(): void { this.errs = {}; }

  errorsFor(path: string): string[] { return this.errs[path] ?? []; }

  /** Whether any error falls under one of these forms (to mark a wizard step). */
  hasIssue(forms: string[], flagged = false): boolean {
    return flagged || Object.keys(this.errs).some((p) => forms.includes(p.split('.')[0]));
  }

  ackBody(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const a of this.view?.page?.acknowledgements ?? []) if (this.acks[a.name]) out[a.name] = a.sha256;
    return out;
  }

  /** Verdicts to submit for a node: a flagged input needs a reason, a verified one needs nothing. */
  verdictBody(node: string): Record<string, { status: string; comment?: string }> {
    const out: Record<string, { status: string; comment?: string }> = {};
    for (const [path, x] of Object.entries(this.verdicts[node] ?? {})) {
      if (x.status === 'flagged') out[path] = { status: 'flagged', comment: x.comment };
      else if (x.status === 'verified') out[path] = { status: 'verified' };
    }
    return out;
  }

  /** The inputs a review node asks a verdict on (derived inputs are not reviewed). */
  reviewInputs(n: PNode): PInput[] {
    const out: PInput[] = [];
    const seen = new Set<string>();
    for (const { inp, f } of this.inputs()) {
      if ((n.forms ?? []).includes(f.name) && !inp.computed && !seen.has(inp.path)) { seen.add(inp.path); out.push(inp); }
    }
    return out;
  }
}
