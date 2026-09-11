import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { selectActiveMembership } from '@/lib/shop-selection';

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(secretKey);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Canonical V1 selected shop -- the same shop the dashboard shows (NEW-F12).
  const { data: membership, error: membershipError } = await selectActiveMembership(supabase, authData.user.id);

  if (membershipError || !membership || membership.role !== 'owner') {
    return NextResponse.json({ error: 'Owner role required' }, { status: 403 });
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('shop_id', membership.shop_id)
    .maybeSingle();

  if (!subscription?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account yet — upgrade a plan first' }, { status: 400 });
  }

  let stripeClient: Stripe;
  try {
    stripeClient = getStripeClient();
  } catch (err) {
    console.error('Stripe client init failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  try {
    const session = await stripeClient.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${req.nextUrl.origin}/dashboard?tab=billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Stripe billing portal session creation failed', {
      shopId: membership.shop_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 });
  }
}
