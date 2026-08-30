# Design QA

final result: blocked

## Source visual truth

The landing-page composition remains grounded in the nine supplied BidWork.app
artboards in `/Users/luv/Documents/Bidwork/ChatGPT Image Aug 30, 2026,
01_19_24 PM (1).png` through `/Users/luv/Documents/Bidwork/ChatGPT Image Aug
30, 2026, 01_19_26 PM (9).png`.

The dashboard previews now use the eight supplied high-resolution PNGs from
`/Users/luv/Downloads/BidWork_High_Resolution_Dashboards/`, mapped as follows:

- overview → hero (`01_bidwork_overview_dashboard.png`)
- smart matching → matching section (`02_bidwork_smart_matching_dashboard.png`)
- campaigns → campaigns section (`03_bidwork_campaigns_dashboard.png`)
- proposal templates → proposal drafts (`04_bidwork_proposal_templates_dashboard.png`)
- notifications → real-time notifications (`05_bidwork_notifications_dashboard.png`)
- bid control → complete bid control (`06_bidwork_bid_control_dashboard.png`)
- analytics → advanced analytics (`07_bidwork_analytics_dashboard.png`)
- academy → BidWork Academy (`08_bidwork_academy_dashboard.png`)

The supplied logo mark from `/Users/luv/Downloads/Black_and_White_Simple_Bold_Typographic_Creative_Studio_Logo-removebg-preview.png`
is used in the landing header and footer, sign-in screen, authenticated app
header, and favicon. The dashboard
PNGs retain their intrinsic dimensions and aspect ratios; they are not cropped,
stretched, or recompressed by the landing page.

## Implementation

The implementation is `/` in `apps/web/src/app/page.tsx`, rendered as a
responsive React component tree with CSS sections for the header, hero
dashboard, trust cards, matching, campaigns, controls, analytics, comparison,
stories, and footer. The sign-in and authenticated app shell share the BidWork
brand lockup in `apps/web/src/app/sign-in/page.tsx` and
`apps/web/src/app/app/layout.tsx`. The supplied artboards remain visual reference
material for the page layout; the eight dashboard PNGs and logo are used as page
assets.

Implementation screenshot: not captured. The production preview starts and
returns HTTP 200 locally, but the browser visual capture was blocked by the
browser service's usage-limit auto-review.

## Verification blocker

The initial sandboxed server start rejected port binding (`listen EPERM`), so the
preview was retried with the approved local escalation and started successfully;
an HTTP HEAD request to `/` returned 200. The browser visual capture was then
rejected by the browser service because its usage-limit auto-review was
unavailable. The webpack production build, TypeScript check, and ESLint check
pass, but a browser-rendered implementation screenshot is not available. Per
the design-QA gate, the source and implementation could not be placed in a
same-viewport comparison input, so visual QA remains blocked.

## Planned comparison

- Viewport: 1672 × 941 CSS px, device scale factor 1.
- State: public landing page at `/`, light theme, top of page.
- Full-view comparison: source artboards versus browser-rendered `/` sections.
- Focused regions: header/hero hierarchy, dashboard preview, feature panels, cards, and final CTA.
- Primary interactions to test: Product/Features/Proof/FAQ anchors, Log in, Start Free, and Book a Demo.
