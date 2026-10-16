import { useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { signInWithEmail, signUpWithEmail, resetPassword } from '../lib/auth';
// import { signInWithProvider } from '../lib/auth'; // uncomment when OAuth buttons return

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

  /* OAuth handler — uncomment when Google/GitHub buttons return
  const handleProvider = async (provider: 'google' | 'github') => {
    setLoading(true); setError('');
    const { error: e } = await signInWithProvider(provider);
    if (e) { setError(e); setLoading(false); }
  }; */

  const switchView = (v: View) => { setView(v); setError(''); setFieldErrors({}); setResetSent(false); };

  return (
    <div className="auth-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-label={view === 'login' ? 'Log in' : view === 'signup' ? 'Sign up' : 'Reset password'}>
        <div className="auth-head">
          <h2>{view === 'login' ? 'Log in' : view === 'signup' ? 'Sign up' : 'Reset password'}</h2>
          <button type="button" className="auth-close" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={1.5} /></button>
        </div>

        <div className="auth-body">
          {/* OAuth buttons hidden until custom domain makes the consent screen show "Lathe" */}

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
