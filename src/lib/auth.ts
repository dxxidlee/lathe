import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';

export type AuthUser = User | null;

export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Auth is not configured' };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + '/t/make' }
  });
  return { error: error?.message ?? null };
}

export async function signInWithProvider(provider: 'google' | 'github'): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Auth is not configured' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin + '/t/make' }
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

export async function getUser(): Promise<AuthUser> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (user: AuthUser) => void): () => void {
  if (!supabase) return () => {};
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
}
