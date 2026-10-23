import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

export function LoginPage({ error: accountError = '' }: { error?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError('Email or password is incorrect.');
    setIsSubmitting(false);
  };

  return (
    <main className="login-page">
      <div className="login-panel">
        <div className="login-brand">
          <img src="/plp.png" alt="PLP logo" />
          <div>
            <div className="login-brand-name">PLPark</div>
            <div className="login-brand-caption">Pamantasan ng Lungsod ng Pasig</div>
          </div>
        </div>

        <div className="login-heading">
          <span className="login-kicker">PARKING OPERATIONS</span>
          <h1>Welcome back</h1>
          <p>Sign in to your PLPark account.</p>
        </div>

        <form className="login-form" onSubmit={event => void handleSubmit(event)}>
          <label htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            placeholder="name@plp.edu.ph"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />

          {(error || accountError) && <div className="login-error" role="alert">{error || accountError}</div>}
          <button className="login-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Log in'}
          </button>
        </form>

        <div className="login-footer">PLPark Management System</div>
      </div>
      <div className="login-aside" aria-hidden="true">
        <div className="login-aside-mark">PLP</div>
        <div className="login-aside-copy">
          <span>PLP PARKING</span>
          <h2>Every arrival,<br />in its right place.</h2>
        </div>
        <div className="login-aside-line" />
        <div className="login-aside-foot">PAMANTASAN NG LUNGSOD NG PASIG</div>
      </div>
    </main>
  );
}