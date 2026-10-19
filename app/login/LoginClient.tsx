'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLoginWithEmail, useLoginWithOAuth, useLoginWithSms } from '@privy-io/react-auth';
import { useScoutAuth } from '@/components/auth/ScoutAuth';
import { LogoLockup } from '@/components/Logo';
import { useTheme } from '@/components/Theme';
import { Notice, btn, field } from '@/components/ui';

type Method = 'email' | 'phone';

const COUNTRIES = [
  // Nigeria first: the default country and the primary audience. Codes are
  // sorted by the people most likely to answer, not alphabetically.
  // Flag images live in public/flags (ISO code + .png).
  ['+234', 'Nigeria', 'ng'],
  ['+233', 'Ghana', 'gh'],
  ['+256', 'Uganda', 'ug'],
  ['+255', 'Tanzania', 'tz'],
  ['+27', 'South Africa', 'za'],
  ['+254', 'Kenya', 'ke'],
  ['+54', 'Argentina', 'ar'],
  ['+55', 'Brazil', 'br'],
  ['+52', 'Mexico', 'mx'],
  ['+57', 'Colombia', 'co'],
  ['+1', 'United States', 'us'],
  ['+44', 'United Kingdom', 'gb'],
] as const;

function LoginLockup() {
  const { theme } = useTheme();
  return <LogoLockup height={44} variant={theme === 'dark' ? 'dark' : 'light'} />;
}

/** Only same-site relative paths are allowed as a post-login destination. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/contribute';
  return raw;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  // "Login with <method> not allowed" means that sign-in method is off for
  // this app, not an origins problem. Check this before the origin pattern.
  if (/login with .+ not allowed|not enabled|disabled|login method/i.test(msg)) {
    return `This sign-in method is not enabled for this Privy app yet. Raw error: ${msg}`;
  }
  if (/origin|domain/i.test(msg)) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'this site';
    return `This origin (${origin}) is rejected by Privy for this app. Raw error: ${msg}`;
  }
  if (/invalid.*code|incorrect/i.test(msg)) return 'That code is not right. Check it and try again.';
  return msg || 'Something went wrong. Try again.';
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function CodeStep({
  sentTo,
  busy,
  onSubmit,
  onResend,
  onBack,
}: {
  sentTo: string;
  busy: boolean;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) onSubmit(code);
      }}
    >
      <p className="text-sm leading-relaxed text-stone">
        We sent a 6-digit code to <span className="text-ivory">{sentTo}</span>.
      </p>
      <label className="flex flex-col gap-2">
        <span className="text-sm text-stone">Code</span>
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={`${field} h-14 text-center font-mono text-2xl tracking-[0.5em]`}
          aria-label="6-digit code"
        />
      </label>
      <button type="submit" disabled={busy || code.length !== 6} className={btn.primary}>
        {busy ? 'Verifying...' : 'Continue'}
      </button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} className="text-stone hover:text-ivory">
          Use something else
        </button>
        <button type="button" onClick={onResend} disabled={busy} className="text-stone hover:text-ivory disabled:opacity-40">
          Resend code
        </button>
      </div>
    </form>
  );
}

function LoginPanel({ next }: { next: string }) {
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState<string>('+234');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Which method a code was sent for. Our own flag, so "use something else"
  // reliably returns to the form regardless of the SDK's internal state.
  const [sentFor, setSentFor] = useState<Method | null>(null);

  const emailFlow = useLoginWithEmail({ onError: (e) => setError(errorText(e)) });
  const smsFlow = useLoginWithSms({ onError: (e) => setError(errorText(e)) });
  const oauth = useLoginWithOAuth({ onError: (e) => setError(errorText(e)) });

  const flow = method === 'email' ? emailFlow : smsFlow;
  const status = flow.state.status;
  const awaitingCode = sentFor === method;
  const fullPhone = `${country}${phone.replace(/\D/g, '').replace(/^0+/, '')}`;

  const send = async () => {
    setError(null);
    try {
      if (method === 'email') await emailFlow.sendCode({ email: email.trim() });
      else await smsFlow.sendCode({ phoneNumber: fullPhone });
      setSentFor(method);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const verify = async (code: string) => {
    setError(null);
    try {
      await flow.loginWithCode({ code });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        disabled={oauth.loading}
        onClick={() => {
          setError(null);
          void oauth.initOAuth({ provider: 'google' }).catch((e: unknown) => setError(errorText(e)));
        }}
        className={`${btn.secondary} h-12 w-full`}
      >
        <GoogleMark />
        {oauth.loading ? 'Opening Google...' : 'Continue with Google'}
      </button>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {!awaitingCode && (
        <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 rounded-full border border-line p-1">
          {(['email', 'phone'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={method === m}
              onClick={() => {
                setMethod(m);
                setError(null);
              }}
              className={`h-9 rounded-full text-sm transition-colors ${
                method === m ? 'bg-elevated text-ivory' : 'text-stone hover:text-ivory'
              }`}
            >
              {m === 'email' ? 'Email' : 'Phone'}
            </button>
          ))}
        </div>
      )}

      {awaitingCode ? (
        <CodeStep
          sentTo={method === 'email' ? email : fullPhone}
          busy={status === 'submitting-code'}
          onSubmit={(c) => void verify(c)}
          onResend={() => void send()}
          onBack={() => {
            setError(null);
            setSentFor(null);
          }}
        />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {method === 'email' ? (
            <label className="flex flex-col gap-2">
              <span className="text-sm text-stone">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={`${field} h-12`}
              />
            </label>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-stone" id="phone-label">
                Phone number
              </span>
              <div className="relative flex items-stretch gap-2" role="group" aria-labelledby="phone-label">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-expanded={pickerOpen}
                  aria-haspopup="listbox"
                  aria-label="Country code"
                  className={`${field} flex h-12 shrink-0 items-center gap-2 px-2.5`}
                >
                  <span aria-hidden className="relative h-5 w-5 overflow-hidden rounded-full ring-1 ring-line">
                    <Image src={`/flags/${COUNTRIES.find((c) => c[0] === country)?.[2] ?? 'ng'}.png`} alt="" width={40} height={40} className="h-full w-full object-cover" draggable={false} />
                  </span>
                  <span className="font-mono text-sm text-ivory">{country}</span>
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden className="text-faint">
                    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                {pickerOpen && (
                  <>
                    <button
                      type="button"
                      aria-hidden
                      tabIndex={-1}
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setPickerOpen(false)}
                    />
                    <ul
                      role="listbox"
                      aria-label="Country code"
                      className="absolute left-0 top-13 z-50 max-h-64 w-64 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-[0_16px_48px_rgba(16,20,15,0.18)]"
                    >
                      {COUNTRIES.map(([code, name, iso]) => (
                        <li key={code + name}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={code === country}
                            onClick={() => {
                              setCountry(code);
                              setPickerOpen(false);
                            }}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none ${
                              code === country ? 'bg-elevated/70 text-ivory' : 'text-stone'
                            }`}
                          >
                            <span aria-hidden className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-line">
                              <Image src={`/flags/${iso}.png`} alt="" width={48} height={48} className="h-full w-full object-cover" draggable={false} />
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                            <span className="shrink-0 font-mono text-[12px] text-faint">{code}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="712 345 678"
                  className={`${field} h-12 min-w-0 flex-1`}
                  aria-label="Phone number"
                />
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={status === 'sending-code' || (method === 'email' ? !email.includes('@') : phone.replace(/\D/g, '').length < 6)}
            className={`${btn.primary} h-12`}
          >
            {status === 'sending-code' ? 'Sending code...' : 'Send code'}
          </button>
        </form>
      )}

      {error && (
        <Notice tone="blood" title="Could not sign in">
          {error}
        </Notice>
      )}

      <p className="text-xs leading-relaxed text-faint">
        Signing in creates a wallet for you on Celo. You never see a seed phrase, and Scout never holds
        your keys. <Link href={next} className="underline underline-offset-2 hover:text-ivory">Skip for now</Link>
      </p>
    </div>
  );
}

export function LoginClient() {
  const auth = useScoutAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  // Arm the post-login redirect exactly once per destination. After the OAuth
  // provider returns, Privy settles the session and provisions the embedded
  // wallet in several passes, re-rendering this component each time. Without
  // the guard, every re-run would clear the previous fallback timer and arm a
  // new one, postponing the hard navigation forever and stranding the user on
  // the "Taking you onward" notice.
  const redirectArmedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!auth.authenticated || redirectArmedFor.current === next) return;
    redirectArmedFor.current = next;
    try {
      router.replace(next);
    } catch {
      window.location.href = next;
      return;
    }
    // One-shot fallback: no cleanup clears this timer, so a cancelled client
    // transition still ends with a full load of the destination.
    setTimeout(() => {
      if (window.location.pathname.startsWith('/login')) window.location.href = next;
    }, 2500);
  }, [auth.authenticated, next, router]);

  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_minmax(0,26rem)] lg:gap-20">
      <div className="flex flex-col gap-6 lg:pt-6">
        <LoginLockup />
        <h1 className="font-display text-5xl leading-[1.02] text-ivory sm:text-6xl">
          Get paid for
          <br />
          what you can see.
        </h1>
        <p className="max-w-md text-[17px] leading-relaxed text-stone">
          Agents ask questions only someone on the ground can answer. Sign in once and your wallet is ready.
          When your answer matches what others report, you are paid in USDC.
        </p>
        <ul className="flex flex-col gap-3 text-sm text-stone">
          {[
            'Sign in with email, phone, or Google',
            'A Celo wallet is created for you automatically',
            'Payouts land in your wallet the moment a bounty settles',
          ].map((t) => (
            <li key={t} className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-citron" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <h2 className="mb-6 text-xl font-semibold text-ivory">Sign in to Scout</h2>
        {!auth.enabled ? (
          <Notice tone="amber" title="Sign-in is not configured">
            Set NEXT_PUBLIC_PRIVY_APP_ID for this deployment to enable email, phone, and Google sign-in.
          </Notice>
        ) : !auth.ready ? (
          <div className="flex flex-col gap-3" aria-busy>
            <div className="h-12 animate-pulse rounded-full bg-elevated" />
            <div className="h-12 animate-pulse rounded-xl bg-elevated" />
          </div>
        ) : auth.authenticated ? (
          <Notice tone="jade" title="Signed in">
            Taking you onward...{' '}
            <Link href={next} className="underline underline-offset-2">
              Continue
            </Link>
          </Notice>
        ) : (
          <LoginPanel next={next} />
        )}
      </div>
    </div>
  );
}
