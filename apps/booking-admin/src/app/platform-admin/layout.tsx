import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getLocale, getTranslations } from 'next-intl/server';

export default async function PlatformAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'platformAdmin' });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect('/login?next=/platform-admin');
  }

  const { data: isAdmin, error: adminCheckError } = await supabase.rpc('is_platform_admin');

  if (adminCheckError) {
    throw new Error(`${t('adminCheckFailed')}: ${adminCheckError.message}`);
  }

  if (!isAdmin) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
