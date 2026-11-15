import { Show } from '@oarkflow/lithe/dom';
import { resolve, type MaybeReactive } from '../../lib/reactive.ts';
import { Spinner } from './Spinner.tsx';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

export interface ButtonProps {
  children?: unknown;
  variant?: ButtonVariant | (() => ButtonVariant);
  type?: 'button' | 'submit';
  busy?: MaybeReactive<boolean>;
  disabled?: MaybeReactive<boolean>;
  onClick?: (event: MouseEvent) => void;
  class?: string;
}

/** The one button implementation the whole app shares. `busy`/`disabled` accept a signal, a getter, or a plain boolean. */
export function Button(props: ButtonProps) {
  // Keep the variant inline: Lithe 1.1.x's dead-code pass drops a `const` that is
  // only referenced inside a template literal, which crashed with
  // "variant is not defined" and left the sign-in form unrendered.
  return (
    <button
      type={props.type ?? 'button'}
      class={() => `fh-btn fh-btn--${resolve(props.variant) ?? 'primary'}${props.class ? ` ${props.class}` : ''}`}
      disabled={() => Boolean(resolve(props.disabled) || resolve(props.busy))}
      onClick={props.onClick}
    >
      <Show when={() => resolve(props.busy)}>
        <Spinner size="sm" />
      </Show>
      <span>{props.children}</span>
    </button>
  );
}
