# AL SHAMI — system quality audit

**Audit date:** 24 October 2026  
**Repository:** `hasanalkhaled06-maker/al-shami-app`  
**Production DB:** connected Supabase project `al_shami_orders`  
**Scope:** all four app entry pages, JavaScript and CSS, PWA manifests/cache, SQL migration files, live RLS/grants and database functions, Supabase security/performance advisors, recent GitHub Actions, and aggregated Auth logs. This is a source/configuration audit, not a formal penetration test or end-to-end certification.

## Executive summary

Good foundations already exist: server-calculated prices, menu availability checks, admin allow-list, rider approval checks, private staff documents, scoped order tracking, cash-only checkout, and GitHub Actions checks. The main risks are shared-origin session handling, large overlapping CSS overrides, sensitive RPCs, limited end-to-end tests, and a growing operations feature set without full role-specific permissions.

## Fixes made during this audit

1. **Auth isolation.** The customer and admin clients previously used Supabase's default auth storage key, while the rider already had a separate key. Same-origin `localStorage` is shared between pages, so the customer and admin could collide. Unique keys are now configured for customer/history, admin and rider. This is preventive, not proof that it caused every Auth error. The last-24-hour aggregate log query returned 485 `refresh_token_not_found` and 89 `refresh_token_already_used` events. Existing customer/admin users may need to sign in again after deployment.
2. **PWA cache and visual identity.** The admin stylesheet's versioned URL was missing from the cache shell; it was added. The current shared design uses burgundy, gold, and warm cream, with the animated 3D chef and AL SHAMI wordmark on the customer home page. `prefers-reduced-motion` disables the animation. The unused `light-theme.css` source remains in the repository because it may matter for rollback or an external reference.
3. **Regression checks.** CI includes the rider approval test plus static checks for duplicate IDs, local assets, manifest icons, CSS load order, cache references, the animated chef, public-key configuration and auth-key separation. Syntax/static tests are not runtime end-to-end tests.

## Review update — 24 October 2026

- Rechecked all repository paths (43 text/code files and 4 image assets), the production Supabase schema, RLS policies, security-definer RPCs and current advisor findings. Also searched 344 web results across 113 distinct websites, then opened authoritative references for checkout, PWA caching, responsive images, WCAG, Supabase RLS/advisors, and OWASP input validation. Web discovery identifies candidate improvements; it is not a substitute for browser-based testing.
- Corrected the README and theme header comment to match the currently deployed burgundy-and-gold identity.
- Removed the unused “Continue without an account” button and its show/hide code. Repository-wide search found no click handler or anonymous sign-in path, and the mandatory authentication gate hid the control whenever it could otherwise appear. Added a regression test to prevent the unsupported control from returning.
- No database policies, functions, indexes, migrations or data were changed. The unused light-theme file and advisor-reported unused indexes were retained because their deletion is not proven safe for rollback or representative production traffic.

## Review update — 27 October 2026

- Read-only inspection of the current production RPC definitions confirmed that both administrator and cashier status changes call `al_shami_order_transition_allowed` and update `orders.updated_at`. No database changes were made during this review.
- Supabase lists `customer-push` as ACTIVE (version 1); the customer subscription UI and administrator order/offer calls are present in the current repository. Actual delivery to a subscribed phone has not been tested, so push delivery is implemented but not yet accepted as end-to-end verified.
- The cashier's order-stage permission is checked server-side. Broader operations permissions still need a role-by-role review; the earlier blanket statement that no staff permissions are enforced was too broad.

## Findings requiring follow-up

| Priority | Finding | Recommended next step |
|---|---|---|
| **P1** | Supabase leaked-password protection is disabled. | Enable it in Auth if the subscription supports it; retain rate limits and sensible password-length rules. |
| **P1** | Several `SECURITY DEFINER` RPCs are executable by authenticated users. | Review every advisor finding individually. Some current functions check admin/rider membership; don't revoke grants blindly. Add negative tests for customer, unapproved rider and unrelated rider. |
| **P1** | Public `get_public_menu_popularity()` exposes exact order counts by menu item. | Decide whether public popularity sorting is worth revealing exact aggregate sales. Prefer a coarse rank/band or safe ordering. |
| **P1** | History exposes hard deletion through `delete_order_for_admin`. | Prefer archive/void with a reason and immutable audit history. Do not delete historical orders or change DB grants until an additive migration and recovery plan are reviewed. |
| **P1** | Customer checkout requires sign-in. | Test account-required vs guest checkout with real customers; treat it as a business decision. Keep phone checks and server-side totals either way. |
| **P2** | Order transition UX and concurrency need a full acceptance test. | The current `admin_transition_order_status` and `cashier_set_order_status` RPCs enforce `al_shami_order_transition_allowed`; the old finding that no server-side check existed is superseded. Test every valid/invalid transition, concurrent updates and receipt-code completion before considering any database change. |
| **P1** | No full browser end-to-end order-flow test exists. | Test submit → admin acceptance → preparation → delivery/pickup handoff code → history using test accounts, never live customer orders. |
| **P1** | Rider GPS is foreground-only on iOS. | Show location freshness; test real iPhone behavior. Native/background location is a separate phase. |
| **P2** | CSS files are large and the cascade relies heavily on `!important`. | Consolidate components gradually with screenshot checks at 320 px, 390 px, tablet and desktop widths. |
| **P2** | CDN assets can change; Supabase JS loads from major tag `@2`. | Pin an exact tested version and add SRI where appropriate; review third-party map/geocoding policies. |
| **P2** | Service-worker caching is network-first and orders require internet. | Keep offline errors explicit and show success only after the server confirms the order. Never cache Supabase API responses. |
| **P2** | Direct table privileges appear broadly granted to anon/authenticated, while RLS currently restricts rows. | Broad grants are not proof of current exposure, but increase the impact of an accidentally loosened policy. Inventory direct grants and reduce privileges on private operations tables only after verifying required customer/admin workflows. |
| **P2** | Menu and offers have multiple permissive read policies. | Consolidate only after confirming intended anon/customer/admin access. |
| **P2** | 21 database indexes were reported unused. | Do not delete based on this signal alone; observe a representative workload and inspect query plans first. |
| **P2** | Phone recovery UI mentions SMS although the setup guide says no SMS provider is configured. | Configure/test a provider or make the working email reset route primary. |
| **P2** | Staff-role enforcement is partial. | The cashier order-status RPC checks cashier/manager/owner role, but this does not establish least-privilege permissions across every operations module. Review each role-to-action path and test non-admin denial before expanding staff access. |
| **P3** | GPS table has RLS enabled but no policies. | This can be safe with direct table grants revoked and scoped RPC-only access; add a test proving direct access is denied. |

## Do not delete these items blindly

- Do not delete `light-theme.css` only because current entry pages don't reference it; the cache entries are removed, but source deletion needs a repository-wide reference/rollback check.
- Do not delete indexes just because an advisor says unused.
- Do not remove receipt codes, tracking tokens or rider security functions; audit their access controls.
- Do not run the legacy consolidated SQL files as though they were a one-to-one representation of the current production migration history.

## Release acceptance checklist

1. Sign-up, sign-in, sign-out, password recovery and isolated sessions for each app.
2. Delivery and pickup checkout; invalid phone/address/map; unavailable product; minimum order; server-calculated price/fee; network timeout.
3. Rapid double taps produce at most one order; failed submission retains the form/cart; success appears only after confirmed save.
4. Admin accept/reject/preparing/ready/out-for-delivery flow; receipt code; completed history. Confirm invalid/skipped state transitions are rejected by the database, not merely hidden in the UI.
5. Customer status stays visible through the correct transition and moves to history only after the intended handoff.
6. Approved rider only sees assigned delivery; cannot update status; GPS is valid/fresh; another customer cannot view that order's location.
7. Unauthorized RPC, table and Storage requests fail for anon, customer, unapproved rider, unrelated rider and non-admin.
8. iPhone Safari/PWA with denied GPS, poor connectivity, reconnect, background/locked screen, stale GPS and new deployment.
9. Keyboard and screen-reader use; modal focus; announced errors; visible focus; contrast; reduced motion; 200% zoom.
10. Browser-based Lighthouse/axe tests and real-user performance checks. Suggested Core Web Vitals targets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at the 75th percentile. Synthetic scores alone aren't certification.

## Reference library reviewed

The reference library contains more than 60 sources covering security, accessibility, browser behavior, testing, database access, performance and map services. For the 24 October review, discovery returned 344 results across 113 distinct websites; authoritative guidance on checkout, caching, responsive images, WCAG, Supabase RLS/advisors and OWASP validation was opened and reviewed. This is research input, not a claim that every listed tool has been run against production.

### Security, authentication and data access
- [OWASP ASVS](https://asvs.owasp.org/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase advisors](https://supabase.com/docs/guides/observability/advisors)
- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)
- [MDN Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [MDN XSS](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/XSS)
- [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)
- [Mozilla Observatory](https://observatory.mozilla.org/)
- [Security Headers](https://securityheaders.com/)
- [NIST Digital Identity](https://pages.nist.gov/800-63-4/)
- [PCI Security Standards Council](https://www.pcisecuritystandards.org/standards/pci-dss/)
- [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [GitHub Code Scanning](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning)
- [GitHub Dependabot](https://docs.github.com/en/code-security/dependabot)
- [GitHub secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning)

### Accessibility and interface quality
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [WAI status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- [W3C Nu HTML Checker](https://validator.w3.org/nu/)
- [WebAIM checklist](https://webaim.org/standards/wcag/checklist)
- [WAVE](https://wave.webaim.org/)
- [axe-core](https://github.com/dequelabs/axe-core)
- [A11Y Project checklist](https://www.a11yproject.com/checklist/)
- [Deque axe](https://www.deque.com/axe/)
- [MDN reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [Can I use](https://caniuse.com/)
- [Siteimprove](https://www.siteimprove.com/)
- [TPGi](https://www.tpgi.com/)

### Performance, caching and observability
- [web.dev PWA updates](https://web.dev/learn/pwa/update)
- [web.dev Core Web Vitals](https://web.dev/articles/vitals)
- [Google Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals)
- [Chrome DevTools performance](https://developer.chrome.com/docs/devtools/performance/overview)
- [Chrome PWA debugging](https://developer.chrome.com/docs/devtools/progressive-web-apps)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [PostgreSQL index statistics](https://www.postgresql.org/docs/current/monitoring-stats.html)
- [RFC 9111 HTTP caching](https://www.rfc-editor.org/rfc/rfc9111)
- [Cloudflare Analytics](https://developers.cloudflare.com/analytics/)
- [WebPageTest](https://www.webpagetest.org/)
- [MDN performance](https://developer.mozilla.org/en-US/docs/Web/Performance)
- [MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Sentry](https://docs.sentry.io/platforms/javascript/)
- [OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/)
- [Datadog synthetics](https://docs.datadoghq.com/synthetics/)
- [Grafana k6 browser](https://grafana.com/docs/k6/latest/using-k6-browser/)
- [LogRocket](https://docs.logrocket.com/)
- [Plausible](https://plausible.io/docs)
- [Matomo](https://matomo.org/guide/)

### Testing, quality and dependencies
- [Node.js test runner](https://nodejs.org/api/test.html)
- [Node.js test coverage](https://nodejs.org/learn/test-runner/collecting-code-coverage)
- [Playwright emulation](https://playwright.dev/docs/emulation)
- [Playwright CI](https://playwright.dev/docs/ci)
- [Cypress](https://docs.cypress.io/)
- [Jest](https://jestjs.io/docs/getting-started)
- [Vitest](https://vitest.dev/guide/)
- [Testing Library](https://testing-library.com/docs/)
- [ESLint](https://eslint.org/docs/latest/)
- [Stylelint](https://stylelint.io/)
- [Prettier](https://prettier.io/docs/)
- [npm audit](https://docs.npmjs.com/cli/v10/commands/npm-audit)
- [Semgrep](https://semgrep.dev/docs/)
- [Snyk](https://docs.snyk.io/)
- [BrowserStack](https://www.browserstack.com/docs)
- [LambdaTest](https://www.lambdatest.com/)
- [Sauce Labs](https://saucelabs.com/)

### Maps, web integrations and service providers
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OpenStreetMap tiles policy](https://operations.osmfoundation.org/policies/tiles/)
- [Leaflet reference](https://leafletjs.com/reference.html)
- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
- [MapLibre](https://maplibre.org/maplibre-gl-js/docs/)
- [openrouteservice](https://openrouteservice.org/dev/#/api-docs)
- [Geoapify](https://apidocs.geoapify.com/)
- [jsDelivr](https://www.jsdelivr.com/)
- [unpkg](https://unpkg.com/)
- [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests)
- [Square developer docs](https://developer.squareup.com/docs)
- [Apple Safari developer tools](https://developer.apple.com/documentation/safari-developer-tools)
- [Apple Add to Home Screen](https://support.apple.com/guide/iphone/add-a-website-icon-to-the-home-screen-iph42ab2f3a7/ios)
- [Google CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [Vercel Speed Insights](https://vercel.com/docs/speed-insights)
- [Netlify deploy previews](https://docs.netlify.com/site-deploys/deploy-previews/)
- [PostHog](https://posthog.com/docs)
