import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';

export type AuthUser = User | null;

export async function signInWithEmail(email: string, password: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Auth is not configured' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signUpWithEmail(email: string, password: string, meta?: { firstName?: string; lastName?: string }): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Auth is not configured' };
  const { error } = await supabase.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: window.location.origin + '/t/library',
      data: meta ? { first_name: meta.firstName, last_name: meta.lastName } : undefined,
    },
  });
  return { error: error?.message ?? null };
}

export async function signInWithProvider(provider: 'google' | 'github'): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Auth is not configured' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin + '/t/library' }
  });
  return { error: error?.message ?? null };
}

export async function resetPassword(email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Auth is not configured' };
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/t/library',
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
