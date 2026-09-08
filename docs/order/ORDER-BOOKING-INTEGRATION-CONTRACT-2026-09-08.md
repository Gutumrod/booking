# Order ↔ Booking integration contract

- Order may request a link only at `READY` and only for `ON_SITE_SERVICE` / `appointmentRequired=true`.
- Booking remains the authority for service, provider, date, time, duration, closures and collision checks. Order receives no priority or bypass.
- One Order may link to multiple Bookings. Link creation is idempotent by `(shop_id, order_id, booking_id, idempotency_key)`.
- Booking completion does not complete Order. Order payment/deposit and Booking deposit remain separate state domains.
- Future runtime implementation must reject cross-shop references before creating a link.
