import type { FooterColumnId, FooterTextId } from "./site-text";

export const EXTERNAL_LINK_REL = "noopener noreferrer";

/** The installer each platform's download button starts: Apple silicon on macOS, x64 elsewhere. */
export const HXBOT_DOWNLOAD_LINKS = {
  macos: "/download/macos/latest",
  windows: "/download/windows/latest",
  linux: "/download/linux/latest",
} as const;

/** The other installer of a platform that ships two architectures. Windows ships x64 only. */
export const HXBOT_ALTERNATE_DOWNLOAD_LINKS = {
  macos: "/download/macos/latest?arch=x64",
  linux: "/download/linux/latest?arch=arm64",
} as const;

/** The pages that describe each installer: requirements, install steps and known limits. */
export const HXBOT_DOWNLOAD_PAGE_LINKS = {
  hub: "/download",
  macos: "/download/macos",
  windows: "/download/windows",
  linux: "/download/linux",
  ios: "/download/ios",
  android: "/download/android",
} as const;

export const HXBOT_LINKS = {
  /** The contact form page. */
  contact: "/contact",
  x: "https://bot.hxallai.com/",
  threads: "https://bot.hxallai.com/",
  linkedin: "https://bot.hxallai.com/",
  reddit: "https://bot.hxallai.com/",
  instagram: "https://bot.hxallai.com/",
  tiktok: "https://bot.hxallai.com/",
  facebook: "https://bot.hxallai.com/",
  /** A Redirect Rule in the bot.hxallai.com Cloudflare zone sends this to the current Discord invite. */
  discord: "https://bot.hxallai.com/",
  download: "#download",
  news: "/news",
  guides: "/guides",
  marketplace: "/marketplace",
  changelog: "/changelog",
  releases: "https://bot.hxallai.com/",
  repository: "https://bot.hxallai.com/",
  license: "https://bot.hxallai.com/",
  privacy: "https://bot.hxallai.com/",
  documentation: "https://bot.hxallai.com/",
  troubleshooting: "https://bot.hxallai.com/",
  /** GitHub Pages hosts the status page, so it stays up when Cloudflare does not. */
  status: "https://bot.hxallai.com/",
  selfHostedServer: "https://bot.hxallai.com/",
  dockerDocumentation: "https://bot.hxallai.com/",
  dockerInstallUbuntu: "https://docs.docker.com/engine/install/ubuntu/",
  architecture: "https://bot.hxallai.com/",
  contributing: "https://bot.hxallai.com/",
  codex: "https://learn.chatgpt.com/docs/app-server",
  claude: "https://code.claude.com/docs/en/overview",
  anthropicAgents: "https://www.anthropic.com/engineering/building-effective-agents",
} as const;

/**
 * The name of a footer entry: a product or page name that stays the same in every language, or the
 * id of its text in `SiteText`.
 */
type FooterLabel = string | { readonly text: FooterTextId };

/**
 * One entry in a footer column. An internal entry carries a route, not a string,
 * so the footer can render it as a client navigation. It also fixes a link that
 * only worked on one page: "#download" on its own finds nothing on /news, because
 * there is no download section there for it to scroll to.
 */
export type FooterLink =
  | { readonly label: FooterLabel; readonly external: true; readonly href: string }
  | {
      readonly label: FooterLabel;
      readonly external: false;
      readonly to:
        | "/"
        | "/download"
        | "/news"
        | "/guides"
        | "/marketplace"
        | "/changelog"
        | "/compare"
        | "/providers"
        | "/teams"
        | "/pricing"
        | "/brand"
        | "/contact"
        | "/privacy-policy"
        | "/terms"
        | "/commercial-license"
        | "/dpa"
        | "/cla";
      readonly hash?: string;
    }
  | {
      readonly label: FooterLabel;
      readonly external: false;
      readonly to: "/compare/$slug" | "/providers/$slug";
      readonly slug: string;
    };

export interface FooterColumn {
  /** The column title, in `SiteText`. */
  readonly id: FooterColumnId;
  readonly links: readonly FooterLink[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    id: "product",
    links: [
      { label: { text: "download" }, external: false, to: "/download" },
      { label: { text: "news" }, external: false, to: "/news" },
      { label: { text: "guides" }, external: false, to: "/guides" },
      { label: { text: "marketplace" }, external: false, to: "/marketplace" },
      { label: { text: "changelog" }, external: false, to: "/changelog" },
      { label: { text: "teams" }, external: false, to: "/teams" },
      { label: { text: "pricing" }, external: false, to: "/pricing" },
      { label: { text: "contact" }, external: false, to: "/contact" },
      { label: { text: "brand" }, external: false, to: "/brand" },
      { label: { text: "sourceCode" }, external: true, href: HXBOT_LINKS.repository },
      { label: { text: "license" }, external: true, href: HXBOT_LINKS.license },
      { label: { text: "privacy" }, external: false, to: "/privacy-policy" },
      { label: { text: "terms" }, external: false, to: "/terms" },
      { label: { text: "commercialLicense" }, external: false, to: "/commercial-license" },
      { label: "DPA", external: false, to: "/dpa" },
      { label: "CLA", external: false, to: "/cla" },
    ],
  },
  {
    id: "resources",
    links: [
      { label: { text: "documentation" }, external: true, href: HXBOT_LINKS.documentation },
      { label: { text: "troubleshooting" }, external: true, href: HXBOT_LINKS.troubleshooting },
      { label: { text: "status" }, external: true, href: HXBOT_LINKS.status },
      { label: { text: "selfHosted" }, external: true, href: HXBOT_LINKS.selfHostedServer },
      { label: { text: "architecture" }, external: true, href: HXBOT_LINKS.architecture },
      { label: { text: "contributing" }, external: true, href: HXBOT_LINKS.contributing },
      { label: "Codex", external: true, href: HXBOT_LINKS.codex },
      { label: "Claude Code", external: true, href: HXBOT_LINKS.claude },
      { label: "Discord", external: true, href: HXBOT_LINKS.discord },
    ],
  },
  {
    id: "providers",
    links: [
      { label: "Claude Code", external: false, to: "/providers/$slug", slug: "claude-code" },
      { label: "Codex", external: false, to: "/providers/$slug", slug: "codex" },
      { label: "Gemini", external: false, to: "/providers/$slug", slug: "gemini" },
      { label: "Grok", external: false, to: "/providers/$slug", slug: "grok" },
      { label: "Cursor", external: false, to: "/providers/$slug", slug: "cursor" },
      { label: "OpenCode", external: false, to: "/providers/$slug", slug: "opencode" },
      { label: "Cline", external: false, to: "/providers/$slug", slug: "cline" },
      { label: { text: "localModels" }, external: false, to: "/providers/$slug", slug: "local-models" },
      { label: { text: "allProviders" }, external: false, to: "/providers" },
    ],
  },
  {
    id: "compare",
    links: [
      { label: "HXBot vs Grok Bot", external: false, to: "/compare/$slug", slug: "grok-bot" },
      { label: "HXBot vs Hermes Agent", external: false, to: "/compare/$slug", slug: "hermes-agent" },
      { label: "HXBot vs Muse", external: false, to: "/compare/$slug", slug: "muse" },
      { label: "HXBot vs OpenClaw", external: false, to: "/compare/$slug", slug: "openclaw" },
      { label: "HXBot vs Claude Cowork", external: false, to: "/compare/$slug", slug: "claude-cowork" },
      { label: "HXBot vs ChatGPT dots", external: false, to: "/compare/$slug", slug: "chatgpt-dots" },
      { label: "HXBot vs Manus", external: false, to: "/compare/$slug", slug: "manus" },
      { label: "HXBot vs Devin", external: false, to: "/compare/$slug", slug: "devin" },
      { label: "HXBot vs Paperclip", external: false, to: "/compare/$slug", slug: "paperclip" },
      { label: "HXBot vs Viktor", external: false, to: "/compare/$slug", slug: "viktor" },
      { label: "HXBot vs Instinct", external: false, to: "/compare/$slug", slug: "instinct" },
      { label: { text: "bestApps" }, external: false, to: "/compare/$slug", slug: "best-ai-agent-apps" },
      { label: { text: "allComparisons" }, external: false, to: "/compare" },
    ],
  },
];
