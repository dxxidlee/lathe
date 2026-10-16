import { useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { signInWithEmail, signUpWithEmail, signInWithProvider, resetPassword } from '../lib/auth';

type View = 'login' | 'signup' | 'forgot';

export function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) {
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!email.includes('@')) errs.email = 'Enter a valid email';
    if (view === 'login' && !password) errs.password = 'Enter your password';
    if (view === 'signup') {
      if (password.length < 6) errs.password = 'At least 6 characters';
      if (password !== confirmPw) errs.confirm = 'Passwords don\'t match';
    }
    setFieldErrors(errs);
    return !Object.keys(errs).length;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true); setError('');
    const { error: e } = await signInWithEmail(email, password);
    setLoading(false);
    if (e) { setError(e); return; }
    onSuccess?.();
    onClose();
  };

  const handleSignup = async () => {
    if (!validate()) return;
    setLoading(true); setError('');
    const { error: e } = await signUpWithEmail(email, password, { firstName, lastName });
    setLoading(false);
    if (e) { setError(e); return; }
    onSuccess?.();
    onClose();
  };

  const handleForgot = async () => {
    if (!email.includes('@')) { setFieldErrors({ email: 'Enter your email first' }); return; }
    setLoading(true); setError('');
    const { error: e } = await resetPassword(email);
    setLoading(false);
    if (e) { setError(e); return; }
    setResetSent(true);
  };

  const handleProvider = async (provider: 'google' | 'github') => {
    setLoading(true); setError('');
    const { error: e } = await signInWithProvider(provider);
    if (e) { setError(e); setLoading(false); }
  };

  const switchView = (v: View) => { setView(v); setError(''); setFieldErrors({}); setResetSent(false); };

  return (
    <div className="auth-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-label={view === 'login' ? 'Log in' : view === 'signup' ? 'Sign up' : 'Reset password'}>
        <div className="auth-head">
          <h2>{view === 'login' ? 'Log in' : view === 'signup' ? 'Sign up' : 'Reset password'}</h2>
          <button type="button" className="auth-close" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={1.5} /></button>
        </div>

        <div className="auth-body">
          {/* OAuth buttons */}
          {view !== 'forgot' && (
            <>
              <button type="button" className="auth-oauth" onClick={() => void handleProvider('google')} disabled={loading}>
                <svg viewBox="0 0 24 24" width="18" height="18"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continue with Google
              </button>
              <button type="button" className="auth-oauth" onClick={() => void handleProvider('github')} disabled={loading}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21.5c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z"/></svg>
                Continue with GitHub
              </button>
              <div className="auth-divider"><span>or</span></div>
            </>
          )}

          {error && <p className="auth-error">{error}</p>}

          {/* Email field */}
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" autoFocus placeholder="you@example.com" />
            {fieldErrors.email && <span className="auth-field-error">{fieldErrors.email}</span>}
          </div>

          {view === 'forgot' && (
            <>
              {resetSent
                ? <p className="auth-success">Check your email for a reset link.</p>
                : <button type="button" className="auth-primary" onClick={() => void handleForgot()} disabled={loading}>{loading ? 'Sending...' : 'Send reset link'}</button>}
              <p className="auth-switch"><button type="button" onClick={() => switchView('login')}>Back to log in</button></p>
            </>
          )}

          {view === 'signup' && (
            <div className="auth-row">
              <div className="auth-field">
                <label htmlFor="auth-first">First name</label>
                <input id="auth-first" type="text" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-last">Last name</label>
                <input id="auth-last" type="text" value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="family-name" />
              </div>
            </div>
          )}

          {view !== 'forgot' && (
            <>
              <div className="auth-field">
                <label htmlFor="auth-pw">Password</label>
                <div className="auth-pw-wrap">
                  <input id="auth-pw" type={showPw ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)} autoComplete={view === 'login' ? 'current-password' : 'new-password'} />
                  <button type="button" className="auth-eye" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide' : 'Show'}>
                    {showPw ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
                  </button>
                </div>
                {fieldErrors.password && <span className="auth-field-error">{fieldErrors.password}</span>}
              </div>
              {view === 'signup' && (
                <div className="auth-field">
                  <label htmlFor="auth-confirm">Confirm password</label>
                  <div className="auth-pw-wrap">
                    <input id="auth-confirm" type={showConfirm ? 'text' : 'password'} value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)} autoComplete="new-password" />
                    <button type="button" className="auth-eye" onClick={() => setShowConfirm(!showConfirm)} aria-label={showConfirm ? 'Hide' : 'Show'}>
                      {showConfirm ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
                    </button>
                  </div>
                  {fieldErrors.confirm && <span className="auth-field-error">{fieldErrors.confirm}</span>}
                </div>
              )}
              <button type="button" className="auth-primary" onClick={() => void (view === 'login' ? handleLogin() : handleSignup())} disabled={loading}>
                {loading ? 'Loading...' : view === 'login' ? 'Log in' : 'Sign up'}
              </button>
              {view === 'login' && <p className="auth-forgot"><button type="button" onClick={() => switchView('forgot')}>Forgot password?</button></p>}
              <p className="auth-switch">
                {view === 'login'
                  ? <>Not a member? <button type="button" onClick={() => switchView('signup')}>Sign up</button></>
                  : <>Already a member? <button type="button" onClick={() => switchView('login')}>Log in</button></>}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
