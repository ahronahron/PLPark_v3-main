/**
 * LoginPage.tsx — Admin console sign-in
 *
 * Uses Supabase Auth (email/password). Credentials are verified
 * by GoTrue, not by reading a password column from `users`.
 */
import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

interface LoginPageProps {
  onSignedIn?: () => void;
}

export function LoginPage({ onSignedIn }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (signInError) {
      setError(signInError.message || 'Invalid email or password.');
      return;
    }

    onSignedIn?.();
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/plp.png" alt="PLPark" className="sidebar-logo" />
          <div>
            <div className="sidebar-title">PLPark</div>
            <div className="sidebar-subtitle">Admin Console</div>
          </div>
        </div>

        <h1 className="login-heading">Sign in</h1>
        <p className="login-copy">Use your staff account to open the dashboard.</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@parking.local"
              disabled={submitting}
            />
          </div>
          <div className="form-group">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={submitting}
            />
          </div>

          {error && <div className="save-status error login-error">{error}</div>}

          <button className="btn-primary login-submit" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
