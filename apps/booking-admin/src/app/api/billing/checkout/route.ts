import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { resolveMonthlyPlan } from '@/lib/commercial-contract';

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(secretKey);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const plan = body?.plan;
  const monthlyPlan = resolveMonthlyPlan(plan);
  const priceId = monthlyPlan ? process.env[monthlyPlan.priceEnvName] : undefined;
  if (!priceId) {
    return NextResponse.json({ error: 'Invalid or unconfigured plan' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from('shop_users')
    .select('shop_id, role')
    .eq('user_id', authData.user.id)
    .limit(1)
    .single();

  if (membershipError || !membership || membership.role !== 'owner') {
    return NextResponse.json({ error: 'Owner role required' }, { status: 403 });
  }

  const { data: existingSubscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('shop_id', membership.shop_id)
    .maybeSingle();

  let stripeClient: Stripe;
  try {
    stripeClient = getStripeClient();
  } catch (err) {
    console.error('Stripe client init failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const origin = req.nextUrl.origin;

  try {
    const session = await stripeClient.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: membership.shop_id,
      metadata: { shop_id: membership.shop_id, plan },
      ...(existingSubscription?.stripe_customer_id
        ? { customer: existingSubscription.stripe_customer_id }
        : { customer_email: authData.user.email }),
      success_url: `${origin}/dashboard?billing=success`,
      cancel_url: `${origin}/dashboard?billing=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session creation failed', {
      shopId: membership.shop_id,
      plan,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
