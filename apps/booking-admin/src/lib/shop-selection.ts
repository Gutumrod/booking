// Canonical selected-shop contract, V1 (Codex NEW-F12).
//
// There is no shop switcher yet, so a user with several memberships must still
// see ONE tenant everywhere. Every caller that picks "the current shop" --
// dashboard layout (Preview slug), fetchAdminDashboardData (dashboard data and
// the bookings-tab customer link), getCurrentShopMembership (ticket data) and
// the billing checkout/portal routes -- selects it with exactly this query:
//
//   the authenticated user's own shop_users rows (user_id = auth uid; normal
//   RLS; never the service role), ordered by created_at ASC NULLS LAST, then
//   shop_id ASC, first row wins.
//
// UNIQUE(shop_id, user_id) makes shop_id a total tiebreak, so independent calls
// over the same membership set always resolve to the same shop. Do not add
// another `from('shop_users')` selection elsewhere; extend this one.

import type { SupabaseClient } from '@supabase/supabase-js';

export type ShopRole = 'owner' | 'admin' | 'staff';

export interface ActiveMembership {
  shop_id: string;
  role: ShopRole;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- used with both the browser and the local_service-schema server client
type AnySupabaseClient = SupabaseClient<any, any, any>;

export async function selectActiveMembership(
  client: AnySupabaseClient,
  userId: string,
): Promise<{ data: ActiveMembership | null; error: { message: string } | null }> {
  const { data, error } = await client
    .from('shop_users')
    .select('shop_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true, nullsFirst: false })
    .order('shop_id', { ascending: true })
    .limit(1)
    .maybeSingle();
  return { data: (data as ActiveMembership | null) ?? null, error };
}
