import { useState } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase.js';

export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function signIn() {
    if (!supabase) { setError('Supabase not configured (VITE_SUPABASE_URL missing).'); return; }
    setBusy(true); setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      setError(err.message || 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg text-text-primary p-6">
      <div className="max-w-sm w-full space-y-6 text-center">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-text-secondary">Roodjino Chérilus</div>
          <h1 className="text-2xl font-semibold mt-1">Personal Brand</h1>
          <p className="text-text-secondary text-sm mt-3">Sign in with Google to access the command center.</p>
        </div>
        {!supabaseConfigured && (
          <div className="card-pad border-warning/40 bg-warning/5 text-warning text-xs text-left">
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
          </div>
        )}
        <button className="btn-primary w-full justify-center" onClick={signIn} disabled={busy || !supabaseConfigured}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && <div className="text-danger text-xs">{error}</div>}
        <div className="text-[11px] text-text-secondary pt-6">
          Only authorized emails get in. Unauthorized accounts see &ldquo;Email not authorized&rdquo; after sign-in.
        </div>
      </div>
    </div>
  );
}
