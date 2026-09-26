# Terms of Service (BK01) — pre-launch draft

> PRE-LAUNCH DRAFT — NOT FINAL
>
> This text is an unreviewed pre-launch draft produced from this product's own repository documentation. It is not legal advice and it is not the contract that will apply at launch. It still requires approval by the Owner of the Service and review by a qualified lawyer.
>
> Awaiting approval — Owner of the Service: PENDING. Qualified legal review: PENDING. Do not rely on this text.
>
> Items shown as [[OWNER INPUT: ...]] are intentionally blank. The Owner has not supplied these values and this draft does not invent them.
>
> Draft version and date: [[OWNER INPUT: effective date and version number of the approved document]]

*Reachable at: `/legal/terms`*

These Terms of Service describe the agreement between you and the operator of BK01. BK01 is a booking and deposit-management service for single-location service businesses in Thailand, such as salons, barber shops, beauty and nail shops. A shop publishes a booking page; a customer books a slot and, where the shop requires one, pays a deposit directly to that shop.

## 1. Who operates the Service

The Service is operated under the brand "WSTERA" and the product name "BK01", as documented in this product's own repository. The formal contracting details are not supplied yet, so this draft leaves them blank: [[OWNER INPUT: registered legal entity name of the operator]], [[OWNER INPUT: company registration number of the operator]], [[OWNER INPUT: registered address of the operator]] and [[OWNER INPUT: address for legal notices]].
BK01 is software that a shop uses to publish a booking page, take bookings and keep deposit evidence. BK01 is not the appointment and it is not the service the shop provides.

## 2. Accepting these Terms

By using the Service you agree to these Terms. If you use the Service for a shop, you confirm that you are authorised to act for that shop. If you do not agree, do not use the Service.
Because this draft has not been approved, the effective date and the version of the final text are not set yet: [[OWNER INPUT: effective date and version number of the approved Terms of Service]].

## 3. What the Service does in its current state

In its current state, as implemented in this repository, BK01 does the following:
- publishes a public mobile web booking page for a shop; a customer books without installing an app and without creating a customer account;
- collects the customer's name and Thai mobile phone number in order to create a booking;
- lets the customer choose a service, a provider or any available provider, a date and an available time slot;
- when the service requires a deposit, holds the slot for 15 minutes while the customer pays the shop's own PromptPay recipient;
- lets the customer upload a deposit slip — JPEG, PNG or WebP, up to 5 MB — which is stored privately so the shop can review it;
- lets the shop accept or reject the submitted slip; automatic slip verification is a Pro capability that is not available until it is released;
- sends the booking confirmation and at least one pre-appointment reminder through LINE, and records whether delivery succeeded or failed;
- lets the customer cancel or reschedule through a private booking link while the shop's policy window is open;
- lets the shop mark a booking completed or no-show, and cancel with a reason.
The product documentation also describes target capabilities that are not implemented yet. The public pages show what is actually shipped, not what is planned.

## 4. Your relationship with the shop

The shop is responsible for the appointment, the service, the price, the deposit amount, and the shop's own cancellation, reschedule and refund policy.
The customer pays the deposit directly to the shop's own PromptPay recipient. BK01 does not hold, receive, escrow or control money belonging to shops, and a deposit paid to a shop is not a payment to WSTERA.
A deposit refund is a shop decision and a shop operation unless a future payment integration explicitly automates it. BK01 does not claim that deposits are refunded automatically.
The default policy wording for deposits, refunds, cancellation and rescheduling that is published to customers must come from the Owner: [[OWNER INPUT: approved default merchant deposit, refund and cancellation policy wording to publish]].

## 5. Shop accounts

Users of the shop side authenticate through the Service's identity provider. Under the current contract one owner may provision one shop per account. You are responsible for the accuracy of the shop details you publish, for keeping your account credentials secure, and for the people you invite into your shop.
Roles are owner, admin and staff, with the access limits set out in the product contract. A staff account sees only its own operational schedule and its own bookings.

## 6. Bookings, holds and deposit evidence

A booking is created only when the requested time is available under the shop's published schedule and does not overlap an existing active booking. Availability is recalculated on the server when the booking is created; the display in the browser is advisory only.
A booking that requires a deposit is held for 15 minutes. If the deposit is not submitted within that window, the hold expires and the time is released.
A deposit slip is uploaded to private storage. It is not published at a permanent public address; it is readable only through authorised access, so that the shop can review that specific booking.
If automatic slip verification is used, it can confirm a deposit only on a positive result tied to the expected amount, merchant and transaction identity. An unknown, timed-out or ambiguous result stays in manual review and is never confirmed automatically. A duplicate transaction reference is rejected or escalated and never confirms two bookings.

## 7. Shop subscription and billing

Shop subscriptions are billed monthly through Stripe. Annual billing is not offered.
The trial starts when a shop is provisioned and runs for 14 days, with an evaluation capacity of 50 bookings and at most 5 active providers. The trial does not convert into a paid plan unless a Stripe checkout or subscription event completes.
Basic and Pro prices are not final. The figures ฿490 per month for Basic and ฿990 per month for Pro are pilot reference points only and are not approved public prices: [[OWNER INPUT: approved final public monthly price for Basic]], [[OWNER INPUT: approved final public monthly price for Pro]].
A paid plan does not stop a normal shop at 100 or 500 bookings per month; a fair-use guard may be applied for abuse or platform protection. Basic and Pro allow at most 5 and at most 10 active providers respectively.
Basic uses manual deposit verification. Pro automatic slip verification is required before Pro is sold publicly, and its monthly allowance and any top-up price are not set yet: [[OWNER INPUT: approved Pro automatic slip-verification monthly allowance and top-up price]].
The WSTERA central LINE account is the standard notification path for Trial, Basic and Pro. A shop-owned LINE account is an optional managed add-on; the shop remains responsible for its own LINE account and message costs, and the add-on price is not set yet: [[OWNER INPUT: approved shop-owned LINE OA managed add-on price]].
Whether the published subscription price includes Thai VAT is not decided: [[OWNER INPUT: VAT treatment of the subscription price]].
Whether a paid subscription fee is refundable is not decided: [[OWNER INPUT: approved subscription fee refund policy]].
An upgrade takes effect only from the authoritative Stripe subscription state, never from a choice made in the interface alone. A downgrade does not delete historical records; capabilities above the new entitlement become impossible to create and impossible to reactivate. A cancellation scheduled for the end of a period keeps the paid entitlement until that period ends; after it ends, new online bookings are blocked while historical data remains available according to the account retention policy.

## 8. Cancellation and rescheduling by the customer

A customer can cancel or reschedule through the private booking link while the shop's configured window is open, and must give a reason. The Service enforces the shop's window on the server; if a change fails, the original booking is not altered. A booking released by cancellation frees the time slot.
The published default windows are the shop's own policy: [[OWNER INPUT: approved default cancellation window and reschedule window to publish]].

## 9. Availability and changes to the Service

The Service runs on Cloudflare Workers with Supabase and Stripe. It may be unavailable while maintenance or a provider incident is resolved. This draft promises no uptime level: [[OWNER INPUT: approved availability commitment, if any]].
These Terms may change. Any material change must be communicated to shop users before it takes effect: [[OWNER INPUT: approved notice period and method for changes to these Terms]].

## 10. Acceptable use

Do not use the Service to break the law; to upload content you have no right to upload; to try to reach data belonging to another shop; to interfere with or overload the Service; or to submit false deposit evidence. A deposit slip is financial evidence, and submitting a slip that does not correspond to a real payment is misuse of the Service.

## 11. Intellectual property

The Service software, its interfaces and its documentation belong to the operator or its licensors. Shop content — such as the shop name, service list, prices, provider list and images — belongs to the shop. The shop grants the operator the limited right to display that content on the shop's public booking page and to operate and support the Service.

## 12. Liability

The Service is software that records bookings and deposit evidence. It does not guarantee that a customer attends, that a customer pays, or that a shop earns revenue. No absolute outcome claim is made, including any guaranteed no-show rate.
The operator is not responsible for the quality of the shop's service, for the shop's deposit or refund decisions, or for LINE message delivery failures, which never change booking state.
The liability cap and the exclusions that apply must be set by a qualified lawyer together with the Owner: [[OWNER INPUT: approved liability cap and liability exclusions]].

## 13. Governing law and disputes

This draft intends these Terms to be governed by the law of Thailand and to be enforced in the courts of Thailand, but no dispute-resolution process has been approved yet: [[OWNER INPUT: approved governing law, jurisdiction and dispute-resolution process]].

## 14. Contact

Questions about these Terms are handled through the support channel published to customers and shops: [[OWNER INPUT: support contact channel shown to customers and merchants]], with published hours of [[OWNER INPUT: published support hours]].
This draft states no support e-mail address and no response-time promise, because the Owner has not supplied them.
