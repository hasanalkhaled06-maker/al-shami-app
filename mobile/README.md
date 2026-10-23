# AL SHAMI native app preparation

This is an isolated, customer-only native build scaffold. It does not replace the GitHub Pages website and it does not change Supabase, SQL migrations, production settings, or the root customer/admin/rider source files.

## Current approach

- Capacitor 8.5.2, with exact top-level dependency versions.
- A build script copies a controlled allow-list of customer-facing web files into the generated `mobile/web/` directory.
- The generated native copy removes website manifest/service-worker bootstrap tags and removes the footer link to the staff portal. Root website source remains unchanged.
- Customer ordering and history continue using the existing HTTPS Supabase services. Internet is required for live menu, authentication, order submission, and tracking.
- Android and iOS platform folders are generated during CI builds rather than committed to the production website repository.
- `appId` in `capacitor.config.ts` is provisional and must be confirmed before public store registration; changing it after release would create a different store app.

## Local build prerequisites

- Node.js 22 or newer.
- Android build: Android SDK and JDK 21 supported by the selected Capacitor Android toolchain.
- iOS build/archive/signing: macOS, Xcode and CocoaPods. Publishing to App Store Connect additionally requires a properly configured Apple Developer account, signing certificate, and provisioning.

From this directory:

```sh
npm install --no-audit --no-fund
npm run prepare:web
npx cap add android
npx cap sync android
# On macOS, for the iOS platform:
npx cap add ios
npx cap sync ios
```

## Preview build workflow

The workflow `.github/workflows/mobile-preview-build.yml` builds an Android debug APK and unsigned release AAB, and compiles an unsigned iOS Simulator app. Artifacts are technical previews only. They are not signed production deliverables, and the Simulator build cannot be installed on an ordinary iPhone.

## Release blockers to resolve before any public submission

1. Review Apple minimum-functionality expectations. A simple web wrapper may be rejected; add and test meaningful native integration and a reliable app-like experience before submission.
2. Customer sign-up currently exists, but no in-app account-deletion flow was found in `customer.js`. This needs a privacy-safe design and server-side review before release. Do not implement deletion by deleting records directly from the browser.
3. Publish and verify an accurate privacy policy and complete Google Play Data safety / account-deletion declarations. Reconcile these with actual Supabase data, analytics, location, support and retention practices.
4. Verify Supabase authentication email redirect URLs for native app sign-up and password recovery. This preparation intentionally does not modify production Auth settings.
5. Test customer sign-in, account creation, password recovery, menu images, delivery/pickup, maps, order history, status updates, external phone/WhatsApp/maps links, app resume, slow internet, and errors on real Android and iPhone devices.
6. Provide a dedicated reviewer account or other reviewer-access method that exposes the customer features without using a real customer account/order.
7. Confirm final app identifier, app name, icons, screenshots, support contact, privacy URL, age/content declarations, and store metadata.
8. Google Play may require a closed test for a newly created personal developer account. Store submission does not guarantee acceptance.

## Safety boundary

Do not run root SQL files or change Supabase production schema/settings as part of native packaging. Any account deletion, redirect allow-list, push notification, role, or access-control changes need a separate, reviewed plan and explicit approval.
