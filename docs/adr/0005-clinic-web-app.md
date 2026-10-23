# ADR 0005 — Clinic web app shell and design system

- Status: Accepted
- Date: 2026-10-23
- Design doc: §4 (navigation), §7 (design system), §9.1 C1, §11.2

## Decisions

- **`@emb/ui` ships TypeScript and CSS source.** Apps compile it with Vite; no separate build step. Tokens are CSS custom properties from §7.1–7.5, with light and dark values and `data-theme="light|dark|system"`.
- **Plain CSS with logical properties only**, no utility framework. A test in `packages/ui` scans every `.css` and `.tsx` file in `apps/` and `packages/` and fails on `margin-left`, `left:`, `text-align: right` and similar. A line may opt out with a `physical-ok` comment (reserved for the game timer side, which is clinical and never mirrored).
- **React Router 7** (data router), **TanStack Query** for server state, **react-intl** for ICU messages. A catalog test checks that every language has every key, that each message parses, that translations use the same arguments as English, and that no message calls an activity an assessment, treatment or diagnosis.
- **Languages:** English and Hebrew first. The language is the user's saved choice, else the browser's first supported language. `lang` and `dir` are set before first paint.
- **Shell:** seven rail destinations for therapists (Today, Patients, Calendar, Protocols, Library, Messages, Reports); Settings in the account menu; phones get four tabs plus More. Destinations not built yet show a plain "coming in the next release" page rather than fake content.
- **One clinic at a time.** The clinic switcher passes `?clinic=` to the API as a filter. RLS still decides what is visible; an id the user doesn't belong to returns nothing and is not written into that clinic's audit log.
- **Session handling:** `/v1/me` decides where a user goes (401 → sign in and return; 403 `mfa_required` → enrolment). After 15 minutes without input the app signs out (checked against wall-clock time, so a sleeping laptop also locks). Rate limiting keys on the client IP from `x-forwarded-for`, set by the load balancer.
- **Accessibility is tested, not assumed:** every end-to-end screen is scanned with axe (WCAG 2.2 AA tags) in English, Hebrew, tablet and phone layouts; focus moves to the page on navigation; one-time-code fields support paste and autofill.
- **Demo build** (`build:demo`) swaps in an in-browser fake API with synthetic data and hash routing. The production build contains none of it (checked by searching the bundle).

## Open

- Production origin layout: serve the SPA and the cell's `/api` and `/v1` from one origin through CloudFront so session cookies stay first-party. Decide with the infrastructure work.
- Bundle is ~530 kB before gzip (~170 kB gzipped). Split auth screens from the shell when the MVP screens land.
