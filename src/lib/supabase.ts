/**
 * Supabase client factory.
 * - Server client: uses SERVICE_ROLE_KEY for privileged server-side operations.
 * - Browser client: uses ANON_KEY only — never exposes the service role key.
 *
 * Import `createServerClient` in API routes and server components.
 * Import `createBrowserClient` in 'use client' components.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Service role key is accessed only in server-side code.
// It is NOT exported as a public variable — only returned inside createServerClient().
function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. This is required for server operations.');
  }
  return key;
}

/**
 * Creates a privileged Supabase client for server-side use only.
 * NEVER call this in 'use client' components or browser code.
 */
export function createServerClient(): SupabaseClient {
  return createClient(supabaseUrl, getServiceRoleKey(), {
    auth: {
      // Service role clients don't need session persistence
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Creates a public Supabase client for browser-side use.
 * Uses only the anon key — safe to call in client components.
 */
export function createBrowserClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey);
}
