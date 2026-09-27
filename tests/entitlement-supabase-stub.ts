// Test double for apps/booking-consumer/src/lib/supabase.ts, used only by
// tests/entitlement-consumer-admin.test.ts (see entitlement-stub-loader.mjs).
//
// It is a real @supabase/supabase-js client pointed at an unreachable host with
// the same `db: { schema: 'local_service' }` setting the app uses, so the
// accessors under test build the same URLs and the same schema header they build
// in production. Its transport is replaced per test by the suite's stubbed
// `globalThis.fetch`, which answers the way PostgREST does. No request ever
// leaves the process: this host is never contacted.

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient('http://stub.invalid', 'stub-anon-key', {
  db: { schema: 'local_service' },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
