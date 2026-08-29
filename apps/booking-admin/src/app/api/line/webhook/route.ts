import { NextResponse } from 'next/server';

// LINE events belong to the consumer app, which verifies the raw body against
// the correct central or merchant channel secret. This retired endpoint must
// not remain as a weaker alternate ingress.
export async function POST() {
  return NextResponse.json(
    { error: 'Configure LINE against the consumer webhook endpoint.' },
    { status: 410 },
  );
}

export async function GET() {
  return NextResponse.json({ status: 'retired' }, { status: 410 });
}
