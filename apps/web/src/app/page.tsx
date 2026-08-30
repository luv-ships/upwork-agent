import {
  ArrowRight,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  Code2,
  FileText,
  Filter,
  Gauge,
  GraduationCap,
  Infinity as InfinityIcon,
  Eye,
  LineChart,
  Mail,
  MessageCircle,
  Moon,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Target,
  ThumbsUp,
  TrendingUp,
  Trophy,
  Users,
  Zap
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export const dynamic = "force-static";

const signInHref = "/sign-in?next=%2Fapp%2Fcampaigns%2Fnew";
type Icon = LucideIcon;

function Brand() {
  return (
    <Link className="landing-brand" href="/" aria-label="BidWork.app home">
      <Image
        alt=""
        aria-hidden="true"
        className="landing-brand-image"
        height={160}
        src="/landing/bidwork-logo-mark.png"
        unoptimized
        width={200}
      />
      <span>BidWork<span className="landing-brand-dot">.app</span></span>
    </Link>
  );
}

function IconBadge({ icon: Icon, tone = "teal" }: { icon: Icon; tone?: "teal" | "blue" | "orange" | "violet" }) {
  return <span className={`landing-icon-badge landing-icon-badge-${tone}`}><Icon size={22} strokeWidth={1.9} aria-hidden="true" /></span>;
}

function CheckList({ items, tone = "teal" }: { items: string[]; tone?: "teal" | "blue" | "orange" }) {
  return <ul className={`landing-check-list landing-check-list-${tone}`}>{items.map((item) => <li key={item}><Check size={16} strokeWidth={2.5} aria-hidden="true" /><span>{item}</span></li>)}</ul>;
}

function SectionIntro({ eyebrow, icon: Icon, title, emphasis, description }: { eyebrow: string; icon: Icon; title: string; emphasis?: string; description: string }) {
  return <div className="landing-section-intro"><div className="landing-eyebrow"><Icon size={16} aria-hidden="true" />{eyebrow}</div><h2>{title} {emphasis ? <span className="landing-emphasis">{emphasis}</span> : null}</h2><p>{description}</p></div>;
}

function Avatar({ initials, tone }: { initials: string; tone: "peach" | "lilac" | "mint" | "sand" | "blue" | "rose" }) {
  return <span aria-hidden="true" className={`landing-avatar landing-avatar-${tone}`}>{initials}</span>;
}

function StarRow() {
  return <span className="landing-stars" aria-label="5 out of 5 stars">{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={15} fill="currentColor" strokeWidth={0} />)}</span>;
}

function DashboardShot({
  alt,
  className = "",
  height,
  priority = false,
  src,
  width
}: {
  alt: string;
  className?: string;
  height: number;
  priority?: boolean;
  src: string;
  width: number;
}) {
  return (
    <figure className={`landing-dashboard-shot ${className}`}>
      <Image
        alt={alt}
        className="landing-dashboard-shot-image"
        height={height}
        priority={priority}
        sizes="(max-width: 640px) calc(100vw - 52px), (max-width: 900px) calc(100vw - 88px), 900px"
        src={src}
        unoptimized
        width={width}
      />
    </figure>
  );
}

function Header() {
  return <header className="landing-header"><div className="landing-container landing-header-inner"><Brand /><nav aria-label="Primary navigation" className="landing-nav"><a href="#product">Product</a><a href="#features">Features</a><a href="#campaigns">Pricing</a><a href="#proof">Proof</a><a href="#footer">FAQ</a></nav><div className="landing-header-actions"><button type="button" aria-label="Light mode" className="landing-icon-button"><Sun size={19} /></button><button type="button" aria-label="Dark mode" className="landing-icon-button"><Moon size={18} /></button><Link className="landing-button landing-button-outline landing-button-small" href="/sign-in">Log in</Link><Link className="landing-button landing-button-primary landing-button-small" href={signInHref}>Start Free <ArrowRight size={16} /></Link></div></div></header>;
}

function HeroDashboard() {
  return (
    <DashboardShot
      alt="BidWork overview dashboard showing matched jobs, proposal preview, client quality, and performance metrics."
      className="landing-dashboard-shot-hero"
      height={1767}
      priority
      src="/landing/dashboards/01_bidwork_overview_dashboard.png"
      width={2560}
    />
  );
}

function Hero() {
  return <section className="landing-hero" id="product"><div className="landing-container landing-hero-grid"><div className="landing-hero-copy"><div className="landing-eyebrow landing-eyebrow-blue"><Sparkles size={16} />AI Upwork Assistant for Freelancers &amp; Agencies</div><h1>Win better Upwork jobs without <span className="landing-emphasis landing-emphasis-hero">chasing</span> the feed.</h1><p>BidWork monitors Upwork 24/7, scores every opportunity for fit, drafts tailored proposals, and helps you bid faster—while you stay in control.</p><div className="landing-pill-row"><span><Users size={16} />Freelancers</span><span><BriefcaseBusiness size={16} />Agencies</span><span><ShieldCheck size={16} />Manual approval</span><span><Zap size={16} />Autopilot</span></div><div className="landing-cta-row"><Link className="landing-button landing-button-primary" href={signInHref}>Start Free <ArrowRight size={18} /></Link><a className="landing-button landing-button-outline" href="mailto:luvautomates@gmail.com?subject=BidWork%20demo">Book a Demo <CalendarDays size={18} /></a></div><div className="landing-reassurance"><span><Check size={15} />No credit card</span><span><Check size={15} />Setup in 2 minutes</span><span><Check size={15} />Cancel anytime</span></div><div className="landing-social-proof"><div className="landing-avatar-stack"><Avatar initials="LM" tone="peach" /><Avatar initials="SK" tone="lilac" /><Avatar initials="DR" tone="mint" /><Avatar initials="AP" tone="sand" /></div><div><StarRow /><span>Trusted by 1,200+ Upwork pros</span></div></div></div><HeroDashboard /></div><div className="landing-container landing-proof-strip"><div><Mail size={20} /><strong>60% open rate</strong><span>Industry-leading outreach</span></div><div><MessageCircle size={20} /><strong>21.8% reply rate</strong><span>More replies, better conversations</span></div><div><Trophy size={20} /><strong>12.5% win rate</strong><span>Win more of the right jobs</span></div></div></section>;
}

const trustedProfiles = [["Lucas M.", "Upwork Consultant & Proposal Strategist", "United States", "100%", "$730K+", "$125/hr", "LM", "peach"], ["Sophie K.", "Brand & Web Designer", "Canada", "100%", "$510K+", "$75/hr", "SK", "lilac"], ["David R.", "Full Stack Developer", "Germany", "99%", "$1.2M+", "$95/hr", "DR", "mint"], ["Anaya P.", "Automation & AI Specialist", "India", "100%", "$600K+", "$80/hr", "AP", "sand"], ["Michael T.", "Digital Marketing Strategist", "United Kingdom", "98%", "$450K+", "$65/hr", "MT", "blue"], ["Isabella N.", "UX/UI Designer", "Italy", "100%", "$320K+", "$60/hr", "IN", "rose"], ["Mark C.", "Data Engineer", "Philippines", "100%", "$390K+", "$70/hr", "MC", "mint"], ["Emma L.", "Business Consultant", "Australia", "100%", "$680K+", "$110/hr", "EL", "sand"], ["Arjun S.", "HubSpot & CRM Automation", "United States", "99%", "$290K+", "$55/hr", "AS", "peach"], ["Natalie B.", "Content Writer", "New Zealand", "100%", "$210K+", "$45/hr", "NB", "lilac"]] as const;

function TrustSection() {
  return <section className="landing-section landing-trust-section" id="proof"><div className="landing-container"><SectionIntro eyebrow="Trusted by Top Upwork Professionals" icon={Star} title="Trusted by high-performing freelancers and lean agencies" description="BidWork is used by serious Upwork professionals across consulting, design, development, automation, and marketing to respond faster and win more qualified work." /><div className="landing-profile-grid">{trustedProfiles.map(([name, role, location, success, earned, rate, initials, tone]) => <article className="landing-profile-card" key={name}><div className="landing-reply-badge"><span />Reply rate {name === "David R." ? "24.7" : name === "Anaya P." ? "17.6" : "21.3"}%</div><div className="landing-profile-head"><Avatar initials={initials} tone={tone} /><div><h3>{name}</h3><p>{role}</p><span><Target size={13} />{location}</span></div></div><div className="landing-profile-meta"><span><ThumbsUp size={15} />{success} Job Success</span><strong>{earned}<small>earned</small></strong></div><strong className="landing-rate">{rate}</strong></article>)}</div><p className="landing-join-line"><Star size={17} fill="#f58b12" strokeWidth={0} /> Join <strong>2,000+</strong> top freelancers and agencies winning more on Upwork with BidWork.</p></div></section>;
}

function MatchDetail() {
  return (
    <DashboardShot
      alt="BidWork smart matching dashboard showing a 96 fit score, screening answers, positive client signals, and risk warnings."
      height={1710}
      src="/landing/dashboards/02_bidwork_smart_matching_dashboard.png"
      width={2560}
    />
  );
}

function MatchingSection() {
  return <section className="landing-section" id="features"><div className="landing-container"><SectionIntro eyebrow="Smart Matching" icon={Sparkles} title="Find the jobs" emphasis="worth" description="BidWork goes beyond keyword filters. Our AI scores each job using client quality, budget, hiring behavior, screening questions, role fit, and your own rules—so you focus on the best opportunities." /><div className="landing-feature-card landing-matching-card"><div className="landing-feature-copy"><IconBadge icon={Target} /><h3>Smarter matches, better outcomes</h3><p>BidWork’s AI evaluates every posting across multiple signals to surface the best-fit jobs and save you hours of manual screening.</p><div className="landing-feature-list"><div><IconBadge icon={LineChart} /><span><strong>Fit score</strong><small>Instant score showing how well a job matches your profile</small></span></div><div><IconBadge icon={Users} /><span><strong>Client-quality signals</strong><small>History, spend, reviews, payment verification, and more</small></span></div><div><IconBadge icon={Filter} /><span><strong>Screening-question checks</strong><small>Pre-qualify jobs based on your must-have answers</small></span></div><div><IconBadge icon={Settings2} /><span><strong>Custom campaign rules</strong><small>Your rules, your way—automatically applied</small></span></div></div><a className="landing-button landing-button-outline" href="#campaigns">See sample match <ArrowRight size={16} /></a></div><MatchDetail /></div></div></section>;
}

function MiniCampaignTable() {
  return (
    <DashboardShot
      alt="BidWork campaigns dashboard showing saved searches, campaign status, matches, reply rates, and win rates."
      height={1228}
      src="/landing/dashboards/03_bidwork_campaigns_dashboard.png"
      width={2560}
    />
  );
}

function ProposalTemplates() {
  return (
    <DashboardShot
      alt="BidWork proposal templates dashboard showing reusable proposal categories and AI personalization."
      height={1225}
      src="/landing/dashboards/04_bidwork_proposal_templates_dashboard.png"
      width={2560}
    />
  );
}

function CampaignsSection() {
  return <section className="landing-section landing-band-section" id="campaigns"><div className="landing-container"><div className="landing-band-heading"><span><span className="landing-dot landing-dot-teal" />Scale your outreach system</span></div><div className="landing-feature-card landing-band-card"><div className="landing-feature-copy"><IconBadge icon={InfinityIcon} /><h3><span className="landing-color-teal">Unlimited</span> Campaigns</h3><p>Create unlimited saved searches to find the right opportunities—across niches, countries, budgets, client-spend levels, hiring activity, and screening-question patterns.</p><CheckList items={["Define your perfect client profile with advanced filters", "Target by geography, budget, spend level, and hiring signals", "Use screening-question patterns to surface better fits", "Track performance and iterate to win more"]} /><a className="landing-button landing-button-outline" href="#control">Explore campaigns <ArrowRight size={16} /></a></div><MiniCampaignTable /></div><div className="landing-feature-card landing-band-card landing-band-card-reverse"><div className="landing-feature-copy"><IconBadge icon={FileText} tone="blue" /><h3><span className="landing-color-blue">Proposal</span> Drafts</h3><p>Turn your profile, templates, case studies, and Q&amp;A into personalized proposal drafts that speak directly to each opportunity—saving hours and helping you sound relevant, not generic.</p><CheckList items={["Leverage your templates, case studies, and past wins", "Auto-tailor to the client, project, and requirements", "Answer screening questions with your knowledge base", "Refine, export, and send with confidence"]} tone="blue" /><a className="landing-button landing-button-outline" href="#control">See templates <ArrowRight size={16} /></a></div><ProposalTemplates /></div></div></section>;
}

function NotificationPanel() {
  return (
    <DashboardShot
      alt="BidWork notification preferences dashboard showing in-app, email, Slack, and Discord alert controls."
      height={1227}
      src="/landing/dashboards/05_bidwork_notifications_dashboard.png"
      width={2560}
    />
  );
}

function ReviewPanel() {
  return (
    <DashboardShot
      alt="BidWork bid-control dashboard showing the review queue, proposal editor, approval actions, scheduling, and boost strategy."
      height={1067}
      src="/landing/dashboards/06_bidwork_bid_control_dashboard.png"
      width={2560}
    />
  );
}

function ControlSection() {
  return <section className="landing-section" id="control"><div className="landing-container"><SectionIntro eyebrow="Real-time control" icon={Zap} title="Stay in control" emphasis="at every step" description="Real-time alerts and complete bidding control keep you ahead of opportunities—and in charge of every decision." /><div className="landing-control-stack"><div className="landing-feature-card landing-control-card"><div className="landing-feature-copy"><div className="landing-eyebrow landing-eyebrow-teal"><Bell size={16} />Real-Time Notifications</div><h3>Never miss the right opportunity</h3><p>Get instant alerts via Slack, Discord, email, or in-app when a qualified job appears, when approval is needed, or when your connect balance or boosting conditions need attention.</p><CheckList items={["Qualified jobs that match your filters", "Manual approval requests and proposal updates", "Connect balance, boost performance, and budget alerts", "Custom channels, quiet hours, and digest options"]} /></div><NotificationPanel /></div><div className="landing-feature-card landing-control-card landing-control-card-reverse"><div className="landing-feature-copy"><div className="landing-eyebrow landing-eyebrow-violet"><Gauge size={16} />Complete Bid Control</div><h3>You decide what gets sent</h3><p>Review proposals before sending, edit drafts, set approval rules, schedule submissions, control boost strategy, and reject low-fit jobs—all in one place.</p><CheckList items={["Review and edit every proposal before it goes out", "Set manual or rule-based approval workflows", "Schedule submissions for the best time to bid", "Control boosts, budgets, and connect usage", "Reject jobs that aren’t the right fit"]} /></div><ReviewPanel /></div></div></div></section>;
}

function AnalyticsPanel() {
  return (
    <DashboardShot
      alt="BidWork analytics dashboard showing open, reply, and win rates, meetings booked, trends, niches, and campaign performance."
      height={1205}
      src="/landing/dashboards/07_bidwork_analytics_dashboard.png"
      width={2560}
    />
  );
}

function AcademyPanel() {
  return (
    <DashboardShot
      alt="BidWork Academy dashboard showing learning paths, recommended lessons, daily checklist, and progress."
      height={1180}
      src="/landing/dashboards/08_bidwork_academy_dashboard.png"
      width={2560}
    />
  );
}

function AnalyticsSection() {
  return <section className="landing-section landing-band-section" id="analytics"><div className="landing-container"><div className="landing-band-heading"><span><span className="landing-dot landing-dot-orange" />Optimize performance over time</span></div><div className="landing-feature-card landing-band-card"><div className="landing-feature-copy"><IconBadge icon={BarChart3} /><h3>Advanced <span className="landing-color-teal">Analytics</span></h3><p>Track open rate, reply rate, wins, meetings booked, campaign performance, top niches, and what types of jobs convert best—so you can double down on what works.</p><CheckList items={["Real-time performance across all campaigns and accounts", "Insights that show what to do next", "Export reports and share results with your team"]} /><a className="landing-button landing-button-outline" href="#footer">Explore analytics <ArrowRight size={16} /></a></div><AnalyticsPanel /></div><div className="landing-feature-card landing-band-card landing-band-card-reverse"><div className="landing-feature-copy"><IconBadge icon={GraduationCap} tone="teal" /><h3>BidWork <span className="landing-color-teal">Academy</span></h3><p>Access onboarding playbooks, setup guides, proposal frameworks, and lessons that help you improve your profile, targeting, and messaging—step by step.</p><CheckList items={["Structured learning paths for every stage", "Actionable guides and templates you can use today", "Learn from winning freelancers and agencies"]} /><a className="landing-button landing-button-outline" href="#footer">Explore Academy <ArrowRight size={16} /></a></div><AcademyPanel /></div></div></section>;
}

function ComparisonSection() {
  const manual = [["Most good jobs seen too late", Eye], ["Bids sent hours after posting", Clock3], ["3.5 hours a day wasted", Clock3], ["18% open rate", Mail], ["9.4% reply rate", MessageCircle]] as const;
  const bidwork = [["Matched jobs surfaced instantly", Zap], ["Apply within 10 minutes of posting", Clock3], ["20 minutes a day of oversight", Clock3], ["58% open rate", Mail], ["22.1% reply rate", MessageCircle]] as const;
  return <section className="landing-section landing-comparison-section"><div className="landing-container"><SectionIntro eyebrow="Why teams switch" icon={Sparkles} title="A more efficient way to turn Upwork into pipeline" description="BidWork helps teams respond faster, waste fewer hours, and book more qualified conversations—so you can focus on closing, not chasing." /><div className="landing-comparison-grid"><ComparisonCard title="Manual Upwork Process" subtitle="Slow, inconsistent, and hard to scale" items={manual} tone="orange" price="$84" /><div className="landing-vs">VS</div><ComparisonCard title="With BidWork" subtitle="Fast, consistent, and built to win" items={bidwork} tone="teal" price="$13.80" /></div><p className="landing-join-line"><Star size={17} fill="#f58b12" strokeWidth={0} /> Join <strong>2,000+</strong> freelancers and agencies booking more meetings on Upwork with BidWork.</p></div></section>;
}

function ComparisonCard({ title, subtitle, items, tone, price }: { title: string; subtitle: string; items: ReadonlyArray<readonly [string, Icon]>; tone: "orange" | "teal"; price: string }) {
  return <article className={`landing-comparison-card landing-comparison-${tone}`}><div className="landing-comparison-title"><IconBadge icon={tone === "teal" ? Sparkles : Users} tone={tone === "teal" ? "teal" : "orange"} /><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="landing-comparison-items">{items.map(([label, ItemIcon]) => <div key={label}><span><ItemIcon size={17} /></span><p>{label}</p></div>)}</div><div className="landing-comparison-price"><small>Cost per meeting booked</small><strong>{price}</strong><span>per meeting booked</span>{tone === "teal" ? <em><TrendingUp size={13} />6.1x lower cost</em> : null}</div></article>;
}

const stories = [["PixelPeak Studio", "Web Design Agency", "BidWork saves us hours every week. We send smarter proposals, cut our response time in half, and book more calls as a result.", "James Carter", "Founder", "London, UK", "P", "peach"], ["Aurelia Design", "Brand & Web Studio", "We respond to new projects within minutes now. That speed helps us stand out and win clients others don’t even reach.", "Sophie Nguyen", "Creative Director", "Vancouver, Canada", "A", "lilac"], ["Northline Digital", "SEO & Content Agency", "The targeting filters are incredibly accurate. We only bid on the right projects and our close rate has doubled.", "Daniel Reyes", "CEO", "Austin, USA", "N", "mint"], ["Brightpath Studio", "UI/UX Design Agency", "More replies. Better conversations. Bigger projects. BidWork turned our Upwork channel into a growth engine.", "Priya Shah", "Growth Lead", "Bengaluru, India", "B", "sand"], ["Metricraft Labs", "Automation & Dev", "We replaced our manual proposal process completely. BidWork handles the grunt work so we can focus on delivering results for clients.", "Marco Bianchi", "Co-founder", "Milan, Italy", "M", "blue"]] as const;

function StoriesSection() {
  return <section className="landing-section landing-stories-section"><div className="landing-container"><SectionIntro eyebrow="Customer Stories" icon={MessageCircle} title="What teams say after switching to" emphasis="BidWork" description="Trusted by independent freelancers and boutique agencies across the world." /><div className="landing-story-grid">{stories.map(([company, type, quote, name, role, location, initials, tone]) => <article className="landing-story-card" key={company}><div className="landing-company-row"><span className={`landing-company-logo logo-${tone}`}>{initials}</span><span><strong>{company}</strong><small>{type}</small></span></div><StarRow /><blockquote>“{quote}”</blockquote><div className="landing-story-person"><Avatar initials={name.split(" ").map((part) => part[0]).join("")} tone={tone} /><span><strong>{name}</strong><small>{role}</small><small><Target size={12} />{location}</small></span></div></article>)}</div><div className="landing-proof-strip landing-proof-strip-four"><div><Clock3 size={20} /><strong>10+ hrs saved</strong><span>per week on outreach</span></div><div><Send size={20} /><strong>70% faster</strong><span>average response time</span></div><div><TrendingUp size={20} /><strong>2x more replies</strong><span>with better targeting</span></div><div><Trophy size={20} /><strong>More clients won</strong><span>higher close rate</span></div></div><p className="landing-join-line"><Star size={17} fill="#f58b12" strokeWidth={0} /> Join <strong>2,000+</strong> freelancers and agencies growing their business with BidWork.</p></div></section>;
}

function Footer() {
  return <footer className="landing-footer" id="footer"><div className="landing-container"><div className="landing-footer-stat"><strong>3,126</strong><span>Upwork client conversations started by BidWork users in the last 30 days</span><small><Sparkles size={16} />Even while they were offline.</small><div className="landing-cta-row"><Link className="landing-button landing-button-primary" href={signInHref}>Start Free <ArrowRight size={18} /></Link><a className="landing-button landing-button-outline" href="mailto:luvautomates@gmail.com?subject=BidWork%20demo">Book a Demo <CalendarDays size={18} /></a></div></div><div className="landing-footer-bottom"><div><Brand /><p>© 2026 BidWork.app. All rights reserved.</p></div><nav aria-label="Footer navigation"><a href="#product">Product</a><a href="#features">Features</a><a href="#campaigns">Pricing</a><a href="#proof">Terms</a><a href="#footer">Privacy</a></nav><div className="landing-social-icons"><a href="https://www.linkedin.com" aria-label="LinkedIn"><Code2 size={18} /></a><a href="https://twitter.com" aria-label="Twitter"><MessageCircle size={18} /></a></div></div></div></footer>;
}

export default function HomePage() {
  return <main className="landing-page"><a className="landing-skip-link" href="#product">Skip to content</a><Header /><Hero /><TrustSection /><MatchingSection /><CampaignsSection /><ControlSection /><AnalyticsSection /><ComparisonSection /><StoriesSection /><Footer /></main>;
}
