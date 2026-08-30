# Design QA

final result: blocked

## Source visual truth

The source visual target is the nine supplied BidWork.app artboards in
`/Users/luv/Documents/Bidwork/ChatGPT Image Aug 30, 2026, 01_19_24 PM (1).png`
through
`/Users/luv/Documents/Bidwork/ChatGPT Image Aug 30, 2026, 01_19_26 PM (9).png`.
Each source is 1672 × 941 px and represents the desktop landing-page composition.

## Implementation

The implementation is `/` in `apps/web/src/app/page.tsx`, rendered as a
responsive React component tree with CSS sections for the header, hero
dashboard, trust cards, matching, campaigns, controls, analytics, comparison,
stories, and footer. The supplied artboards remain visual reference material;
they are not used as page content.

Implementation screenshot: not captured (preview could not bind a local port).

## Verification blocker

The local Next.js preview could not be started because this environment rejects
server port binding (`listen EPERM`). The webpack production build, TypeScript
check, and ESLint check pass, but a browser-rendered implementation screenshot is
not available. Per the design-QA gate, the source and implementation could not be
placed in a same-viewport comparison input, so visual QA remains blocked.

## Planned comparison

- Viewport: 1672 × 941 CSS px, device scale factor 1.
- State: public landing page at `/`, light theme, top of page.
- Full-view comparison: source artboards versus browser-rendered `/` sections.
- Focused regions: header/hero hierarchy, dashboard preview, feature panels, cards, and final CTA.
- Primary interactions to test: Product/Features/Proof/FAQ anchors, Log in, Start Free, and Book a Demo.
