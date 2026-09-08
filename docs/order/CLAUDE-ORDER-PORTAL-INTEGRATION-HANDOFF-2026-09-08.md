# Order portal handoff

Reserved public route: `/order/[slug]`. Until the shared-runtime gate passes it must fail closed: no generated order number, payment success, capacity reservation, or tracking result.

Future Claim context may receive only an opaque Order tracking token and a server-validated Order reference; it must not receive phone-only lookup or private Order data. Order-to-Booking link creation is idempotent and delegates availability/collision to Booking only after Order is READY.
