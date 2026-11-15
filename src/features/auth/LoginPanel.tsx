import { signal } from '@oarkflow/lithe/core';
import { Show } from '@oarkflow/lithe/dom';
import { Alert } from '../../components/ui/Alert.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { authApi } from '../../lib/secure-client.ts';
import { describeError } from '../../lib/types.ts';
import { authConfig, busy, formError, otpRequired, phase, signIn } from '../../state/session.ts';

type Mode = 'signin' | 'register' | 'verify';
const mode = signal<Mode>('signin');
const notice = signal<string | undefined>(undefined);
const problem = signal<string | undefined>(undefined);
const pendingAccount = signal<string | undefined>(undefined);

function field(data: FormData, name: string): string {
  return String(data.get(name) ?? '').trim();
}

function handleSignIn(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  notice.value = undefined;
  void signIn(field(data, 'username'), String(data.get('password') ?? ''), {
    otp: field(data, 'otp') || undefined,
    tenant: field(data, 'tenant') || undefined,
  }).then(() => {
    if (phase.value === 'authenticated') form.reset();
  });
}

async function handleRegister(event: SubmitEvent) {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  problem.value = undefined;
  try {
    const out = await authApi.register({
      email: field(data, 'email'),
      name: field(data, 'name'),
      password: String(data.get('password') ?? ''),
      tenant: field(data, 'tenant') || undefined,
    });
    pendingAccount.value = String(out.accountId);
    if (out.verify === false) {
      notice.value = 'Account created. You can sign in now.';
      mode.value = 'signin';
    } else {
      notice.value = out.devCode ? `Development only: your code is ${String(out.devCode)}` : 'We sent you a verification code.';
      mode.value = 'verify';
    }
  } catch (error) {
    problem.value = describeError(error);
  }
}

async function handleVerify(event: SubmitEvent) {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  problem.value = undefined;
  try {
    await authApi.verifyOtp(pendingAccount.value ?? '', field(data, 'code'));
    notice.value = 'Verified. You can sign in now.';
    mode.value = 'signin';
  } catch (error) {
    problem.value = describeError(error);
  }
}

const multiTenant = () => Boolean(authConfig.value?.multiTenant);
const mfa = () => (authConfig.value?.mfa ?? 'optional') !== 'off';

/**
 * The signed-out landing view. It adapts to config/app.bcl through GET /auth/config:
 * a tenant field in multi-tenant deployments, a registration form when enabled, and
 * an authenticator-code field when the account (or policy) requires one.
 */
export function LoginPanel() {
  return (
    <div class="fh-auth-gate">
      <Show when={() => mode.value === 'signin'}>
        <Card class="fh-auth-card" eyebrow="Authentication required" title="Sign in to continue">
          <p class="fh-auth-card__lede">
            Sessions are HttpOnly-cookie based; every <code>/api/*</code> call afterwards runs over the encrypted WASM
            transport, not plain fetch.
          </p>
          <form class="fh-form" onSubmit={handleSignIn}>
            <Show when={multiTenant}>
              <label class="fh-field">
                <span>Organisation</span>
                <input name="tenant" autocomplete="organization" placeholder={() => authConfig.value?.defaultTenant ?? ''} />
              </label>
            </Show>
            <label class="fh-field">
              <span>{() => (authConfig.value?.identifier === 'email' ? 'Email' : 'Username')}</span>
              <input name="username" autocomplete="username" required autofocus />
            </label>
            <label class="fh-field">
              <span>Password</span>
              <input name="password" type="password" autocomplete="current-password" required />
            </label>
            <Show when={() => mfa() && (otpRequired.value || authConfig.value?.mfa === 'required')}>
              <label class="fh-field">
                <span>Authenticator code</span>
                <input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength={6} />
              </label>
            </Show>
            <Show when={() => Boolean(notice.value)}>
              <Alert tone="info">{notice}</Alert>
            </Show>
            <Show when={() => Boolean(formError.value)}>
              <Alert tone="error">{formError}</Alert>
            </Show>
            <Button type="submit" busy={() => busy.value && phase.value === 'signing-in'} class="fh-form__submit">
              Sign in
            </Button>
          </form>
          <Show when={() => Boolean(authConfig.value?.registration)}>
            <p class="fh-auth-card__lede">
              New here?{' '}
              <a href="#register" onClick={(e: Event) => { e.preventDefault(); problem.value = undefined; mode.value = 'register'; }}>
                Create an account
              </a>
            </p>
          </Show>
        </Card>
      </Show>
      <Show when={() => mode.value === 'register'}>
        <Card class="fh-auth-card" eyebrow="New account" title="Create your account">
          <form class="fh-form" onSubmit={(e: SubmitEvent) => void handleRegister(e)}>
            <Show when={multiTenant}>
              <label class="fh-field">
                <span>Organisation</span>
                <input name="tenant" placeholder={() => authConfig.value?.defaultTenant ?? ''} />
              </label>
            </Show>
            <label class="fh-field">
              <span>Name</span>
              <input name="name" autocomplete="name" />
            </label>
            <label class="fh-field">
              <span>Email</span>
              <input name="email" type="email" autocomplete="email" required />
            </label>
            <label class="fh-field">
              <span>Password</span>
              <input name="password" type="password" autocomplete="new-password" required />
            </label>
            <Show when={() => Boolean(problem.value)}>
              <Alert tone="error">{problem}</Alert>
            </Show>
            <Button type="submit" class="fh-form__submit">Create account</Button>
            <Button variant="ghost" onClick={() => { mode.value = 'signin'; }}>Back to sign in</Button>
          </form>
        </Card>
      </Show>
      <Show when={() => mode.value === 'verify'}>
        <Card class="fh-auth-card" eyebrow="Check your messages" title="Enter your verification code">
          <form class="fh-form" onSubmit={(e: SubmitEvent) => void handleVerify(e)}>
            <Show when={() => Boolean(notice.value)}>
              <Alert tone="info">{notice}</Alert>
            </Show>
            <label class="fh-field">
              <span>Code</span>
              <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength={6} required autofocus />
            </label>
            <Show when={() => Boolean(problem.value)}>
              <Alert tone="error">{problem}</Alert>
            </Show>
            <Button type="submit" class="fh-form__submit">Verify</Button>
          </form>
        </Card>
      </Show>
    </div>
  );
}
