# Order post-gate acceptance probes

These are required runtime tests, not simulated PASS evidence:

1. concurrent confirmations cannot exceed effective capacity;
2. same idempotency key retries one reservation;
3. pre-production cancellation releases exactly once;
4. `shop_id` mismatch rejects catalog/order/link references;
5. calendar/settings race resolves under one transaction lock/snapshot;
6. partial confirmation never returns success without snapshot, reservation and promised date;
7. opaque tracking token cannot read another shop/order;
8. `order_enabled=false` blocks new intake while preserving history.

They remain RUNTIME-BLOCKED until authorized product-local migrations/RPCs exist. Pure tests in this branch prove only deterministic decisions, never database atomicity.
