import { signal } from '@oarkflow/lithe/core';
import { FormState, type PView } from './formstate.ts';
import { ApiError } from '../../lib/types.ts';

/**
 * State shared by every screen that shows a workflow case: the form state, a
 * counter that redraws the renderer, a busy flag, and `run`, which performs a
 * server call and folds the result (a fresh view, or field errors) back in.
 */
export function caseController() {
  const st = new FormState();
  const tick = signal(0);
  const busy = signal(false);
  const redraw = () => { tick.value = tick.value + 1; };

  async function run(fn: () => Promise<PView>, ok: string): Promise<void> {
    busy.value = true;
    st.clearErrors();
    try {
      st.apply(await fn());
      st.notice = ok ? { kind: 'ok', text: ok } : undefined;
    } catch (e) {
      if (e instanceof ApiError) {
        st.setErrors(e.fields);
        st.notice = {
          kind: 'error',
          text: e.status === 409 ? `${e.message} Reload to get the latest version.` : e.message,
          list: e.fields.map((f) => (f.path && f.path !== 'comment' ? `${st.label(f.path)}: ${f.message}` : f.message)),
        };
      } else {
        st.notice = { kind: 'error', text: e instanceof Error ? e.message : String(e) };
      }
    } finally {
      busy.value = false;
      redraw();
    }
  }

  return { st, tick, busy, run, redraw };
}
