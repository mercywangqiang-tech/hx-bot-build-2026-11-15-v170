import { AppLogo } from "@hxbot/brand";
import type { JSX } from "@solidjs/web";

export interface TransactionalPageProps {
  /** The `id` of the card's heading. The card uses it as its accessible name. */
  titleId: string;
  /** `message` centres short text and actions. `form` makes the card wider and aligns it to the start. */
  layout?: "message" | "form";
  /** More classes for the card, for example `contact-section` for the form field colours. */
  class?: string;
  /**
   * The language of the page text, when it comes from the catalogs. The site header and footer stay
   * in English, so the attribute goes on `<main>` and not on `<html>`.
   */
  lang?: string;
  children: JSX.Element;
}

/**
 * The frame of a page that does one task: join a server, return from Slack or Discord, return from
 * billing, report a site, or show a load error. It has the site header, one centred card, and the
 * site footer, so that these pages look like the rest of the site.
 */
export function TransactionalPage(props: TransactionalPageProps) {
  return (
    <div class="landing-page transactional-page">
      {/* HXBot：只留标志和产品名，链接回下载页；不显示上游官网的导航与页脚 */}
      <header class="landing-header">
        <a class="landing-brand" href="/" aria-label="HXBot">
          <AppLogo variant="production" class="landing-brand-logo" />
          <span>HXBot</span>
        </a>
      </header>
      <main class="transactional-main" lang={props.lang}>
        <section
          class={props.class ? `join-card transactional-card ${props.class}` : "join-card transactional-card"}
          data-layout={props.layout ?? "message"}
          aria-labelledby={props.titleId}
        >
          {props.children}
        </section>
      </main>
      {/* 研究版不显示上游官网的页脚 */}
    </div>
  );
}
