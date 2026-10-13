import { useState } from 'react';
import { useShell } from './state';
import { signInWithEmail, signInWithProvider, signOut } from '../lib/auth';

export function AuthMenu() {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  if (!shell.user) {
    return (
      <div className="auth-menu">
        <button type="button" className="l-btn auth-menu__trigger" onClick={() => setOpen(o => !o)}>Sign in</button>
        {open && (
          <div className="auth-menu__dropdown">
            <button type="button" className="auth-menu__provider" onClick={() => signInWithProvider('google')}>
              Continue with Google
            </button>
            <button type="button" className="auth-menu__provider" onClick={() => signInWithProvider('github')}>
              Continue with GitHub
            </button>
            <div className="auth-menu__divider">or</div>
            <form onSubmit={async e => {
              e.preventDefault();
              setSending(true); setError('');
              const { error: err } = await signInWithEmail(email);
              setSending(false);
              if (err) setError(err); else setSent(true);
            }}>
              <input className="l-input auth-menu__email" type="email" placeholder="Email" value={email}
                onChange={e => setEmail(e.target.value)} required disabled={sending} />
              <button type="submit" className="l-btn l-btn--primary" disabled={sending || !email}>
                {sent ? 'Check your email' : 'Send magic link'}
              </button>
              {error && <p className="auth-menu__error">{error}</p>}
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="auth-menu">
      <button type="button" className="auth-menu__trigger" onClick={() => setOpen(o => !o)}>
        {shell.user.email?.split('@')[0] ?? 'Account'}
      </button>
      {open && (
        <div className="auth-menu__dropdown">
          <span className="auth-menu__email-display">{shell.user.email}</span>
          <button type="button" className="l-btn" onClick={() => { void signOut(); setOpen(false); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
