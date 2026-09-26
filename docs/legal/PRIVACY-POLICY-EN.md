# Privacy Policy (BK01) — pre-launch draft

> PRE-LAUNCH DRAFT — NOT FINAL
>
> This text is an unreviewed pre-launch draft produced from this product's own repository documentation. It is not legal advice and it is not the contract that will apply at launch. It still requires approval by the Owner of the Service and review by a qualified lawyer.
>
> Awaiting approval — Owner of the Service: PENDING. Qualified legal review: PENDING. Do not rely on this text.
>
> Items shown as [[OWNER INPUT: ...]] are intentionally blank. The Owner has not supplied these values and this draft does not invent them.
>
> Draft version and date: [[OWNER INPUT: effective date and version number of the approved document]]

*Reachable at: `/legal/privacy`*

This Privacy Policy describes what personal data BK01 holds, why it holds it, who else is involved, and what rights a person has under the Thai Personal Data Protection Act (PDPA). It is written from the documentation in this product's own repository and is limited to what the Service actually does in its current state.

## 1. Who is responsible for this personal data

BK01 is software used by shops. Two parties handle personal data: the shop that receives the booking, and WSTERA, which operates the platform.
The situation recorded in this repository is that booking-customer data — name, mobile phone number, LINE binding and booking history — belongs to one shop and can be read by that shop's owner and admin roles; shop and staff account data is used to authenticate users and operate the shop; and subscription and billing identifiers are held at Stripe.
The formal allocation of PDPA roles, controller or processor, between WSTERA and the shop, for shop-owner data, staff data and booking-customer data, has not been approved and must be confirmed by qualified legal review: [[OWNER INPUT: approved PDPA role allocation between WSTERA and the merchant for shop-owner, staff and booking-customer personal data]].

## 2. Personal data the Service holds

The Service holds the following categories of personal data:
- shop account: the login e-mail and authentication data handled by the identity provider; shop name, link slug, business category, phone number, address, PromptPay recipient number, PromptPay account name and LINE official account identifier;
- providers and staff: name, nickname, phone number, weekly working hours, breaks and time off;
- booking customer: name and Thai mobile phone number, the chosen service, the provider, the date, the time, the booking status, and any cancellation or reschedule reason; a customer has no account and no password, because public booking is anonymous by design;
- deposit evidence: the deposit amount, the deposit status, and the uploaded slip image kept in private storage;
- notifications: the LINE account binding for a booking, the notification event type, and the delivery success or failure result;
- operations: support ticket content, audit events recording who acted, on what and when, and security logs.
The booking page asks a customer for a name and a mobile phone number only. It does not ask for an e-mail address, an identity document or a card number. A deposit is paid by PromptPay from the customer to the shop, so the bank-side PromptPay transaction records are held by the banks of the customer and the shop, not by BK01.

## 3. Why the Service processes this data

Each item below is a purpose for which the Service currently processes personal data:
- creating a booking and honouring it, and preventing two bookings from occupying the same provider and time;
- letting the shop verify that a deposit was paid before the appointment is treated as confirmed;
- sending the confirmation and the pre-appointment reminder through LINE;
- authenticating shop users and limiting what each role can see and change;
- charging the shop for its subscription and keeping billing records consistent with Stripe;
- handling support requests about a booking, a shop or an account;
- keeping an audit trail of booking, deposit, entitlement and privileged-operator actions;
- protecting the Service against abuse, overload, duplicate deposit evidence and security incidents.
The Service does not use booking-customer data for advertising and does not sell personal data.

## 4. Lawful basis

The Service must have a lawful basis for each purpose above. Consent is used only where it is legally and operationally appropriate; it is not treated as a substitute for analysing the lawful basis of a purpose.
The lawful basis for each purpose has not been approved and must be reviewed by a qualified lawyer: [[OWNER INPUT: approved lawful basis for each processing purpose]].

## 5. Cookies and similar storage

As of this draft, the public customer booking pages in this repository store the customer's language choice in the cookie named saas_locale and in local storage under the same name, so that the page remembers whether Thai or English was chosen. No third-party analytics, advertising or tracking script was found in the public customer application in this repository.
If non-essential analytics, advertising cookies or similar identifiers are introduced later, the consent and notice requirements are to be reviewed before they are enabled.
The shop-facing application may store the signed-in session in the browser. That session storage is required for authentication and is listed here as a functional storage item.

## 6. Subprocessors and external parties

The Service relies on the following external parties. The list matches the dependency inventory in the product documentation:
- Supabase — authentication, the Postgres database and the private object storage that holds deposit slips. Data categories: shop account data, provider and staff data, booking-customer data, deposit slips, audit and support records.
- Cloudflare — the runtime that serves the public booking application and the shop application. Data categories: the request and security data needed to serve the pages.
- Stripe — monthly shop subscription billing, payment method handling, invoices and subscription state. Data categories: shop billing identity and subscription identifiers.
- LINE, operated by LY Corporation — delivery of confirmation and reminder messages, and the binding between a booking and a LINE account. Data categories: the LINE user binding and the message content.
- Supabase Auth e-mail delivery path — verification and password-recovery messages for shop users. Data categories: the shop user's e-mail address.
- Automatic slip-verification provider — not selected yet. Pro automatic verification is required before Pro is sold publicly: [[OWNER INPUT: automatic slip-verification provider name and processing details]].
The processing location of each party, and the person who owns the vendor privacy and security review, are not confirmed in this draft: [[OWNER INPUT: confirmed data location or region for each subprocessor]], [[OWNER INPUT: named owner of vendor privacy and security review]]. The contractual terms with each party must be recorded before public launch.

## 7. Transfer and location of data

Some of the parties above may process data outside Thailand. The cross-border transfer implications of each provider, and whether any transfer mechanism is required, have not been reviewed: [[OWNER INPUT: approved cross-border transfer assessment and any required transfer mechanism]].

## 8. How long data is kept

The Service does not yet have approved retention periods. The exact durations are a launch blocker and must be decided by the Owner together with qualified legal review. The classes below are exactly the classes that the legal and privacy checklist requires a decision for:
- customer and booking records: [[OWNER INPUT: retention period for customer and booking records]];
- deposit-slip images: [[OWNER INPUT: retention period for deposit-slip images]];
- LINE notification and binding logs: [[OWNER INPUT: retention period for LINE notification and binding logs]];
- authentication and account data: [[OWNER INPUT: retention period for authentication and account data]];
- Stripe and billing records: [[OWNER INPUT: retention period for Stripe and billing records]];
- support tickets and attachments: [[OWNER INPUT: retention period for support tickets and attachments]];
- security and audit logs: [[OWNER INPUT: retention period for security and audit logs]];
- backups after account closure: [[OWNER INPUT: retention period for backups after account closure]].
Engineering documentation cannot determine these periods, so this draft states no number.

## 9. Your PDPA rights and how to use them

Under the Thai Personal Data Protection Act (PDPA) you have the right to access and obtain a copy of your personal data, to request correction, to request deletion, to request restriction of processing, to object to processing, to withdraw consent where consent is the basis, and to complain to the Office of the Personal Data Protection Committee.
A request is handled by verifying the requester and the scope of the request, then classifying the records into what can be removed, what can be anonymised and what must be retained for legal, accounting or security reasons, then executing the approved procedure and recording the outcome and any exception.
Because no retention, role or lawful-basis decision has been approved yet, this draft promises no response deadline: [[OWNER INPUT: approved identity-verification steps and response deadline for data-subject requests]], [[OWNER INPUT: privacy request channel for customers, staff and merchants]].

## 10. How the data is protected

The Service is built so that private data is reachable only by an authorised shop membership and role: private tables are protected by row level security, and server-side functions with elevated privilege verify the shop and the role before they act. Public booking pages can read only the fields needed to display a shop and calculate availability.
Deposit slips are held in a private bucket, uploaded through a per-booking signed upload authorisation, and downloaded only through authorised access so that the shop can review them. Permanent public links are not used.
Stripe keys, database service-role keys and LINE channel secrets stay on the server. They are never placed in client code or in shop-visible settings.
Booking, deposit, reschedule, cancellation, entitlement and privileged-operator actions are recorded in an audit trail identifying who acted, on what and when.

## 11. If there is a data breach

The product has an incident runbook and a separate support and escalation path for security and privacy incidents. Whether, when and how affected people, the shop, or a regulator must be notified is a legal determination and has not been approved: [[OWNER INPUT: approved breach notification duties and timelines]].

## 12. Age of users

Public booking is designed to be used by a person arranging their own appointment or an appointment for someone they accompany. No minimum age statement has been approved: [[OWNER INPUT: approved minimum age statement for the Service]].

## 13. Changes to this privacy notice

This notice will change as the Service changes and as the Owner makes the decisions listed above. Any material change must be communicated to shop users before it takes effect, and the effective date and version must be recorded: [[OWNER INPUT: approved notice period and method for changes to this Privacy Policy]], [[OWNER INPUT: effective date and version number of the approved Privacy Policy]].

## 14. Contact for privacy requests

Privacy requests and questions about this notice are handled through: [[OWNER INPUT: privacy request channel for customers, staff and merchants]], with published hours of [[OWNER INPUT: published support hours]].
This draft states no e-mail address and no response deadline, because the Owner has not supplied them.
