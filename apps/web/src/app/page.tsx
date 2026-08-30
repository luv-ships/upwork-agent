import Image from "next/image";
import Link from "next/link";

import type { ReactNode } from "react";

export const dynamic = "force-static";

type Hotspot = {
  href: string;
  label: string;
  className: string;
};

const imageWidth = 1672;
const imageHeight = 941;

const sections = [
  {
    id: "proof",
    src: "/landing/trust.png",
    alt: "BidWork is trusted by high-performing freelancers and lean agencies."
  },
  {
    id: "features",
    src: "/landing/matching.png",
    alt: "Smart matching feature overview with fit score, client-quality signals, screening checks, and custom campaign rules."
  },
  {
    id: "campaigns",
    src: "/landing/campaigns-proposals.png",
    alt: "BidWork outreach features showing unlimited campaigns and proposal drafts."
  },
  {
    id: "control",
    src: "/landing/control.png",
    alt: "BidWork control features showing real-time notifications and complete bid control."
  },
  {
    id: "analytics",
    src: "/landing/analytics-academy.png",
    alt: "BidWork analytics and academy tools for improving outreach performance."
  },
  {
    id: "comparison",
    src: "/landing/comparison.png",
    alt: "Comparison of a manual Upwork process with the faster, more consistent BidWork workflow."
  },
  {
    id: "stories",
    src: "/landing/stories.png",
    alt: "Customer stories from teams that switched to BidWork."
  },
  {
    id: "faq",
    src: "/landing/footer.png",
    alt: "BidWork closing call to action and footer navigation."
  }
] as const;

function Hotspot({ href, label, className }: Hotspot) {
  return (
    <Link
      aria-label={label}
      className={`landing-hotspot ${className}`}
      href={href}
    />
  );
}

function LandingImage({
  src,
  alt,
  priority = false
}: {
  src: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <Image
      alt={alt}
      className="landing-art"
      height={imageHeight}
      priority={priority}
      quality={96}
      sizes="(max-width: 1672px) 100vw, 1672px"
      src={src}
      width={imageWidth}
    />
  );
}

function HiddenContent({ children }: { children: ReactNode }) {
  return <div className="sr-only">{children}</div>;
}

export default function HomePage() {
  return (
    <main className="landing-page">
      <a className="landing-skip-link" href="#content">
        Skip to content
      </a>

      <section className="landing-frame landing-hero" id="content">
        <LandingImage alt="BidWork.app landing page hero" priority src="/landing/hero.png" />

        <div aria-label="Landing page navigation" className="landing-hotspot-layer">
          <Hotspot className="hotspot-product" href="#features" label="Product" />
          <Hotspot className="hotspot-features" href="#features" label="Features" />
          <Hotspot className="hotspot-pricing" href="#campaigns" label="Pricing" />
          <Hotspot className="hotspot-proof" href="#proof" label="Proof" />
          <Hotspot className="hotspot-faq" href="#faq" label="FAQ" />
          <Hotspot className="hotspot-login" href="/sign-in" label="Log in" />
          <Hotspot
            className="hotspot-hero-start"
            href="/sign-in?next=%2Fapp%2Fcampaigns%2Fnew"
            label="Start free"
          />
          <Hotspot
            className="hotspot-hero-demo"
            href="mailto:luvautomates@gmail.com?subject=BidWork%20demo"
            label="Book a demo"
          />
        </div>

        <HiddenContent>
          <h1>Win better Upwork jobs without chasing the feed.</h1>
          <p>
            BidWork monitors Upwork 24/7, scores every opportunity for fit, drafts tailored
            proposals, and helps you bid faster—while you stay in control.
          </p>
        </HiddenContent>
      </section>

      {sections.map((section) => (
        <section className="landing-frame" id={section.id} key={section.id}>
          <LandingImage alt={section.alt} src={section.src} />

          {section.id === "faq" ? (
            <div className="landing-hotspot-layer" aria-label="Closing call to action">
              <Hotspot
                className="hotspot-footer-start"
                href="/sign-in?next=%2Fapp%2Fcampaigns%2Fnew"
                label="Start free"
              />
              <Hotspot
                className="hotspot-footer-demo"
                href="mailto:luvautomates@gmail.com?subject=BidWork%20demo"
                label="Book a demo"
              />
            </div>
          ) : null}

          <HiddenContent>
            <h2>{section.alt}</h2>
          </HiddenContent>
        </section>
      ))}

    </main>
  );
}
