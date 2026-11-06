# AL SHAMI release handoff

Updated: 6 November 2026. This checklist records what is already live, what is prepared, and the remaining release gates. It is not a legal certificate or proof of an end-to-end acceptance test.

## Verified

- Customer PWA: https://alshamiapp.xyz/
- Admin: https://alshamiapp.xyz/admin.html
- Rider: https://alshamiapp.xyz/rider.html
- GitHub Actions static script validation passed for the current release work.
- The current Pages site is deployed. A subsequent docs-only Pages run may still be queued while GitHub serializes deployments.
- Production Supabase project `rxjfvuxzseuybfmfyjvs` is active and healthy, PostgreSQL 17.
- Production organization is on the Supabase Free plan.
- A legacy order RPC execute grant was removed from `PUBLIC`, `anon`, and `authenticated`; the secure order wrappers remain available.
- Customer account signup now defers name/phone collection until after authentication.
- SMS/phone sign-in and online payments remain outside this release gate, as requested.

## Release gates

### 1. Ghana privacy and DPC

Complete the DPC registration with the restaurant's legal controller identity and actual operating details. Publish a final privacy notice with the verified controller/contact, data purposes, recipients, provider locations, retention criteria, and rights/complaint route. The existing `PRIVACY_NOTICE_DRAFT.md` and `LAUNCH_COMPLIANCE_DRAFT.md` are drafts only. Do not invent company identity, retention periods, or provider promises.

### 2. Customer account deletion

There is no customer account deletion flow in the current PWA. Deleting only the Supabase Auth user would leave personal data in `public.orders`: customer name, phone and possibly delivery address/location. Orders also retain customer IDs and tracking tokens unless explicitly cleared. Other user-linked records include customer profiles, username mapping, push subscriptions/preferences, reviews, reward ledger, referral codes and referrals.

Implementation must be an authenticated, re-authenticated, idempotent flow that:
- refuses or defers deletion while the customer has an active order;
- removes account credentials, profile data, notification subscriptions/preferences and other account-only personal data;
- anonymizes personal fields and unlinks the customer from retained order/accounting records, if the documented legal retention policy requires keeping those records;
- invalidates outstanding sessions and tracking access;
- reports success only after all required steps complete, and safely supports retry after a partial external Auth deletion.

Before rollout, add and review a transactional database migration/RPC plus an authenticated server-side function and customer UI, test it with disposable test accounts, then deploy the function and migration in order. Do not enable a UI button that calls an undeployed function. No production migration or deletion has been performed in this preparation.

### 3. Registration abuse and password security

The public `customer-auth` username-registration function creates Auth users through the Admin API. It has no durable per-IP rate limiter or CAPTCHA today. Supabase Auth's built-in controls do not automatically prove protection for this custom Admin API path.

Before promoting registration broadly:
- add a CAPTCHA/Turnstile verification path with its public and secret keys configured in the correct places, or an equivalent durable server-side limiter;
- confirm the Auth signup/password limits in the dashboard and test repeated requests return a controlled 429 without creating duplicate users;
- enable leaked-password protection. The project organization is Free, so the Supabase feature is not currently available on this plan; upgrade or choose an independently reviewed mitigation before launch.

Never put a service-role/secret key in the browser. The Edge Function must validate its own requests and fail closed when abuse-control secrets are required but missing.

### 4. Real order and location acceptance

Use dedicated staging accounts and a non-production order to prove:
1. customer signup/sign-in and recovery;
2. delivery and pickup checkout, server-calculated total, and retry/double-tap behavior;
3. admin acceptance/rejection and valid stage transitions;
4. assigned rider sees the correct order and fresh location;
5. delivery code completes the order and it appears in customer/admin history;
6. unauthorized customer/rider/staff access is denied.

Do not use a real customer's order for this test. iPhone foreground GPS freshness still needs a real-device check; background iOS GPS is not claimed.

### 5. Android and iOS packages

The main branch is the web/PWA app and does not contain a current Android native project or a production signing workflow. The earlier Android preview came from the separate `mobile-store-prep` branch and is not a current signed Play release. Before Google Play:
- port/rebuild from current `main`, not the old preview;
- set and verify the final application ID, versioning, icons, permissions and privacy links;
- build a release AAB and sign with the owner's upload key kept outside the repository;
- test install, upgrades, login, maps, push, deep links and deletion on supported Android devices.

iOS requires a separately signed build and Apple developer setup. A simulator preview is not a store package. Do not commit keystores, signing passwords, service keys, or personal access tokens.

## Status

| Area | Status |
|---|---|
| Public web/PWA availability | Live; static CI and Pages deployment verified |
| Legacy order RPC grant | Fixed and live |
| Customer signup profile persistence | Updated in current web app |
| Phone/SMS login | Explicitly excluded; provider delivery remains unverified |
| Electronic payment | Explicitly excluded |
| DPC/privacy | Draft only; owner/legal facts and filing are required |
| Account deletion | Not implemented; needs reviewed retention behavior and database/server work |
| Signup abuse controls | Not complete; durable protection/secrets are missing |
| Authenticated order/GPS acceptance | Not verified end to end |
| Current signed Android/iOS release | Not available |

The public website can be opened now, but the gates above must close before claiming public launch or store readiness.
