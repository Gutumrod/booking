# Order portal handoff

Reserved public route: `/order/[slug]`. Until the shared-runtime gate passes it must fail closed: no generated order number, payment success, capacity reservation, or tracking result.

The current route exposes `data-runtime-status="ORDER_RUNTIME_UNAVAILABLE"` and disables all submission/tracking controls. Portal integration may link to this route, but must not interpret route existence as Order availability. Future enablement must come from a trusted server-side capability/runtime check.

Public submission sends only product selection IDs, quantities, requested date, customer/fulfillment input and an idempotency key. The Order server adapter owns catalog reload, snapshot construction, totals, lifecycle/payment/deposit state and confirmation. Do not pass client-computed snapshots or internal state fields across the Portal boundary.

Future Claim context may receive only an opaque Order tracking token and a server-validated Order reference; it must not receive phone-only lookup or private Order data. Order-to-Booking link creation is idempotent and delegates availability/collision to Booking only after Order is READY.
