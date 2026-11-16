/** Keep the existing project's persisted session and PKCE verifier when its
 * public transport moves behind our own domain. Other projects stay isolated. */
const HOSTED_PROJECT = 'https://sjdlkprlkaweyuiaigix.supabase.co';
const STABLE_GATEWAY = 'https://api.inteliads.io/db';
const EXISTING_STORAGE_KEY = 'sb-sjdlkprlkaweyuiaigix-auth-token';

export function supabaseDestination(input: string): { url: string; storageKey?: string } {
  const url = input.trim();
  const origin = url.replace(/\/+$/, '');
  if (origin === HOSTED_PROJECT || origin === STABLE_GATEWAY) {
    return { url: STABLE_GATEWAY, storageKey: EXISTING_STORAGE_KEY };
  }
  return { url };
}
