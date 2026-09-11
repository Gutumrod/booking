import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';
import { ShopSlugProvider } from '@/components/preview-customer-page';
import { selectActiveMembership } from '@/lib/shop-selection';

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect('/login?next=/dashboard');
  }

  // Canonical V1 selected shop (lib/shop-selection): the same shop that
  // dashboard, ticket and billing data resolve to (NEW-F12).
  const { data: membership, error: membershipError } = await selectActiveMembership(supabase, data.claims.sub);

  if (membershipError) {
    throw new Error(`ตรวจสอบสิทธิ์ร้านค้าไม่สำเร็จ: ${membershipError.message}`);
  }

  if (!membership) {
    redirect('/register?resume=1');
  }

  // Slug for the Preview action on every dashboard route (NEW-F9). A failed
  // read renders no Preview rather than a fake URL; it never blocks the dashboard.
  const { data: shop } = await supabase
    .from('shops')
    .select('slug')
    .eq('id', membership.shop_id)
    .maybeSingle();

  return (
    <ShopSlugProvider shopId={membership.shop_id} slug={shop?.slug ?? null}>
      <form action={signOut} className="fixed right-4 top-4 z-[100]">
        <button className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs font-semibold text-slate-300 shadow-lg hover:bg-slate-800">
          ออกจากระบบ
        </button>
      </form>
      {children}
    </ShopSlugProvider>
  );
}
