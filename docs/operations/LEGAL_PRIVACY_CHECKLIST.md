# BK01 Legal & Privacy Readiness Checklist

**Status:** PRE-LAUNCH CHECKLIST — NOT LEGAL ADVICE

Public launch requires qualified legal/privacy review for applicable Thai law and actual production practices. Engineering documentation cannot determine lawful basis or statutory retention by itself.

## Customer-facing documents
- [ ] Privacy Policy matches actual collection, purposes, recipients, retention and data-subject channels.
- [ ] Terms of Service match subscription, cancellation, service availability, merchant/customer responsibility and limitation wording.
- [ ] Merchant deposit/refund/cancellation policy wording is explicit and does not imply WSTERA holds merchant funds when it does not.
- [ ] Support/contact/privacy request channels are published.

## PDPA/data processing questions for legal review
- [ ] Roles of WSTERA and merchant for shop-owner, staff and booking-customer personal data are documented.
- [ ] Lawful basis/notice requirements are reviewed for each purpose.
- [ ] Consent is used only where legally/operationally appropriate, not as a universal substitute for lawful-basis analysis.
- [ ] Data-subject access/correction/deletion/objection processes and identity verification are approved.
- [ ] Cross-border transfer/data-location implications of providers are reviewed.

## Subprocessors / external parties
Inventory at minimum: Supabase, Cloudflare, Stripe, LINE/LY, email/auth delivery path and automatic slip-verification provider. Record purpose, data categories, location where known, contractual/privacy terms and owner of vendor review.

## Retention decisions requiring approval
- [ ] customer and booking records;
- [ ] deposit-slip images;
- [ ] LINE notification/binding logs;
- [ ] auth/account data;
- [ ] Stripe/billing records;
- [ ] support tickets/attachments;
- [ ] security/audit logs;
- [ ] backups after account closure.
## Analytics/cookies
- [ ] If non-essential analytics/advertising cookies or similar identifiers are introduced, consent/notice requirements are reviewed before enabling them.
- [ ] Analytics taxonomy avoids unnecessary PII and does not ingest secrets/slip content.

## Security/breach readiness
- [ ] Incident response ownership and contact path established.
- [ ] Applicable breach/incident notification duties and timelines confirmed by legal/privacy review.
- [ ] Evidence preservation and affected-data identification are operationally possible.
- [ ] Private deposit-slip access and privileged operator access have auditable controls.

## Marketing claims
- [ ] Every quantified outcome claim has owned supporting evidence.
- [ ] “No-show 100%” and equivalent absolute claims prohibited.
- [ ] V1 target capabilities are not advertised as shipped before release evidence.
- [ ] Pricing, quotas, LINE/auto-slip allowance and billing cadence match authoritative product docs exactly.

## Launch blocker
Unchecked legal/privacy items that affect required notices, data handling, retention, breach obligations or customer contract prevent public launch even if technical gates pass.
