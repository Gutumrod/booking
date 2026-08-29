import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// --- Configuration -----------------------------------------------------------

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

function getStripeClient(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(STRIPE_SECRET_KEY);
}

// Confirmed live against API version 2026-07-29 (E4.6 verification): the
// Subscription object no longer carries current_period_end at the top level
// — it only exists per subscription item. Read it from the first item.
function getSubscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  return sub.items.data[0]?.current_period_end ?? null;
}

// Confirmed live (E4.6): scheduling a cancellation via the Billing Portal
// leaves cancel_at_period_end === false and instead sets cancel_at to the
// period-end timestamp. Treat either signal as "cancellation scheduled".
function isCancelScheduled(sub: Stripe.Subscription): boolean {
  return sub.cancel_at_period_end || sub.cancel_at != null;
}

// --- Price-to-plan mapping ---------------------------------------------------
// Per the design doc, price_id maps to plan 'basic_490' or 'pro_990'.
// The actual price IDs are set up in the Stripe Dashboard (E4.2) and stored
// as env vars STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO. Until those exist, we
// fall back to a heuristic on the price lookup key or leave the plan as-is.
function mapPriceIdToPlan(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_BASIC) return 'basic_490';
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro_990';
  return null;
}

// --- Event payload extraction helpers ---------------------------------------

interface CheckoutSessionPayload {
  shopId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string | null;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

function extractCheckoutSession(
  session: Stripe.Checkout.Session,
): CheckoutSessionPayload {
  // Per design doc section 2.2.1:
  //   session.client_reference_id or session.metadata.shop_id -> shop_id
  //   session.customer -> stripe_customer_id
  //   session.subscription -> stripe_subscription_id
  const shopId =
    (session.client_reference_id as string | null) ??
    (session.metadata?.shop_id as string | null) ??
    null;
  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  const stripeSubscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;

  // Determine plan from metadata (the checkout route in E4.5 will set this).
  let plan: string | null = null;
  if (session.metadata?.plan) {
    plan = session.metadata.plan;
  }

  return {
    shopId,
    stripeCustomerId,
    stripeSubscriptionId,
    plan,
    status: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
}

interface SubscriptionPayload {
  stripeSubscriptionId: string;
  plan: string | null;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

function extractSubscription(sub: Stripe.Subscription): SubscriptionPayload {
  // Per design doc section 2.2.2:
  //   subscription.id -> stripe_subscription_id
  //   subscription.items.data[0].price.id -> map to plan
  //   subscription.status -> status
  //   subscription.current_period_end -> current_period_end
  //   subscription.cancel_at_period_end -> cancel_at_period_end
  const priceId = sub.items.data[0]?.price?.id ?? null;
  return {
    stripeSubscriptionId: sub.id,
    plan: mapPriceIdToPlan(priceId),
    status: sub.status,
    currentPeriodEnd: getSubscriptionPeriodEnd(sub),
    cancelAtPeriodEnd: isCancelScheduled(sub),
  };
}

interface InvoicePayload {
  stripeSubscriptionId: string | null;
  invoicePeriodEnd: number | null;
}

function extractInvoice(invoice: Stripe.Invoice): InvoicePayload {
  // Per design doc section 2.2.4 and 2.2.5:
  //   invoice.subscription -> stripe_subscription_id
  // In Stripe SDK v22, the subscription ID is nested under
  // parent.subscription_details.subscription (string | Subscription).
  const subDetails = invoice.parent?.subscription_details;
  const subId = subDetails
    ? (typeof subDetails.subscription === 'string'
        ? subDetails.subscription
        : subDetails.subscription?.id ?? null)
    : null;

  return {
    stripeSubscriptionId: subId,
    invoicePeriodEnd: invoice.period_end ?? null,
  };
}

// --- Idempotency guard -------------------------------------------------------

async function isDuplicateEvent(
  eventId: string,
  eventType: string,
  eventCreated: number,
): Promise<boolean> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin.rpc('claim_stripe_webhook_event', {
    p_id: eventId,
    p_type: eventType,
    p_created_at: new Date(eventCreated * 1000).toISOString(),
  });

  if (error) {
    console.error('stripe_webhook_events insert failed', {
      eventId,
      eventType,
      error: error.message,
      code: error.code,
    });
    throw new Error(`Stripe event journal failed: ${error.message}`);
  }

  return data !== true;
}

// --- RPC helper for atomic state sync ---------------------------------------

interface SyncStateParams {
  eventType: string;
  eventCreated: number;
  shopId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string | null;
  status: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean | null;
}

async function syncSubscriptionState(params: SyncStateParams): Promise<{ applied: boolean }> {
  const supabaseAdmin = getSupabaseAdmin();

  const rpcArgs: Record<string, unknown> = {
    p_event_type: params.eventType,
    p_event_created: params.eventCreated,
    p_shop_id: params.shopId,
    p_stripe_customer_id: params.stripeCustomerId,
    p_stripe_subscription_id: params.stripeSubscriptionId,
    p_plan: params.plan,
    p_status: params.status,
    p_current_period_end: params.currentPeriodEnd,
    p_cancel_at_period_end: params.cancelAtPeriodEnd,
  };

  const { data, error } = await supabaseAdmin.rpc('sync_subscription_state_bk_a', rpcArgs);

  if (error) {
    throw new Error(`sync_subscription_state RPC failed: ${error.message}`);
  }

  const result = data as { applied: boolean; matched_shop_id: string | null }[] | null;
  const applied = result?.[0]?.applied ?? false;
  return { applied };
}

// --- Main webhook handler ----------------------------------------------------

export async function POST(req: NextRequest) {
  // 1. Read the raw body BEFORE any JSON parsing (needed for signature verify).
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('stripe-signature');

  if (!signatureHeader) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 },
    );
  }

  // 2. Verify the Stripe signature. On failure, return 400 immediately
  //    without touching the database.
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 },
    );
  }

  let stripeClient: Stripe;
  try {
    stripeClient = getStripeClient();
  } catch (err) {
    console.error('Stripe client init failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Stripe client not configured' },
      { status: 500 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripeClient.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    // Signature verification failure — return 400, do NOT touch the DB.
    return NextResponse.json(
      { error: 'Invalid Stripe signature' },
      { status: 400 },
    );
  }

  // 3. Idempotency guard: insert into stripe_webhook_events. If the event.id
  //    already exists (duplicate), return 200 immediately.
  try {
    const duplicate = await isDuplicateEvent(event.id, event.type, event.created);
    if (duplicate) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (err) {
    console.error('Idempotency guard failed', {
      eventId: event.id,
      eventType: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'idempotency_guard_failed' }, { status: 500 });
  }

  // 4. Dispatch to the appropriate event handler. Each handler calls the
  //    sync_subscription_state RPC, which atomically writes to subscriptions
  //    AND shops.subscription_status in a single transaction, and includes
  //    the out-of-order timestamp guard internally.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const payload = extractCheckoutSession(session);

        // If the checkout has a subscription, fetch the full subscription object
        // to get the status, current_period_end, and cancel_at_period_end.
        if (payload.stripeSubscriptionId) {
          try {
            const sub = await stripeClient.subscriptions.retrieve(
              payload.stripeSubscriptionId,
            );
            payload.status = sub.status;
            payload.currentPeriodEnd = getSubscriptionPeriodEnd(sub);
            payload.cancelAtPeriodEnd = isCancelScheduled(sub);
            if (!payload.plan) {
              payload.plan = mapPriceIdToPlan(sub.items.data[0]?.price?.id);
            }
          } catch (err) {
            console.error('Failed to retrieve subscription after checkout', {
              subscriptionId: payload.stripeSubscriptionId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        await syncSubscriptionState({
          eventType: event.type,
          eventCreated: event.created,
          shopId: payload.shopId,
          stripeCustomerId: payload.stripeCustomerId,
          stripeSubscriptionId: payload.stripeSubscriptionId,
          plan: payload.plan,
          status: payload.status,
          currentPeriodEnd: payload.currentPeriodEnd,
          cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
        });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const currentSub = await stripeClient.subscriptions.retrieve(sub.id);
        const payload = extractSubscription(currentSub);

        await syncSubscriptionState({
          eventType: 'customer.subscription.updated',
          eventCreated: event.created,
          shopId: null,
          stripeCustomerId: null,
          stripeSubscriptionId: payload.stripeSubscriptionId,
          plan: payload.plan,
          status: payload.status,
          currentPeriodEnd: payload.currentPeriodEnd,
          cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const payload = extractSubscription(sub);

        await syncSubscriptionState({
          eventType: event.type,
          eventCreated: event.created,
          shopId: null,
          stripeCustomerId: null,
          stripeSubscriptionId: payload.stripeSubscriptionId,
          plan: null,
          status: 'canceled',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const payload = extractInvoice(invoice);

        // For invoice.paid, use the invoice's period_end as the current
        // billing period end. This is the most reliable source — it comes
        // directly from the invoice object without needing an extra API call.
        const currentSub = payload.stripeSubscriptionId
          ? await stripeClient.subscriptions.retrieve(payload.stripeSubscriptionId)
          : null;
        const currentPeriodEnd = currentSub ? getSubscriptionPeriodEnd(currentSub) : payload.invoicePeriodEnd;

        await syncSubscriptionState({
          eventType: event.type,
          eventCreated: event.created,
          shopId: null,
          stripeCustomerId: null,
          stripeSubscriptionId: payload.stripeSubscriptionId,
          plan: currentSub ? extractSubscription(currentSub).plan : null,
          status: currentSub?.status ?? 'active',
          currentPeriodEnd,
          cancelAtPeriodEnd: null,
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const payload = extractInvoice(invoice);

        const currentSub = payload.stripeSubscriptionId
          ? await stripeClient.subscriptions.retrieve(payload.stripeSubscriptionId)
          : null;
        await syncSubscriptionState({
          eventType: event.type,
          eventCreated: event.created,
          shopId: null,
          stripeCustomerId: null,
          stripeSubscriptionId: payload.stripeSubscriptionId,
          plan: currentSub ? extractSubscription(currentSub).plan : null,
          status: currentSub?.status ?? 'past_due',
          currentPeriodEnd: currentSub ? getSubscriptionPeriodEnd(currentSub) : null,
          cancelAtPeriodEnd: currentSub ? isCancelScheduled(currentSub) : null,
        });
        break;
      }

      default:
        // Event type we don't handle — ack it so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    console.error('Stripe webhook event processing failed', {
      eventId: event.id,
      eventType: event.type,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const admin = getSupabaseAdmin();
    const { error: releaseError } = await admin.from('stripe_webhook_events')
      .update({ processing_status: 'failed', last_error: err instanceof Error ? err.message.slice(0, 500) : 'processing failed' })
      .eq('id', event.id).eq('processing_status', 'processing');
    if (releaseError) console.error('Failed to mark Stripe event retryable', { eventId: event.id, error: releaseError.message });
    return NextResponse.json({ error: 'internal_processing_error' }, { status: 500 });
  }

  const { error: completionError } = await getSupabaseAdmin().from('stripe_webhook_events')
    .update({ processing_status: 'processed', processed_at: new Date().toISOString(), last_error: null })
    .eq('id', event.id).eq('processing_status', 'processing');
  if (completionError) return NextResponse.json({ error: 'event_completion_failed' }, { status: 500 });

  return NextResponse.json({ received: true });
}
