import { defineMessages } from "../../message";

/**
 * The public web pages: the home page, the header, menu and footer around every page, and the pages
 * that do one task: join a server, return from Slack or Discord, return from billing, report a hosted
 * site, and the load error page. `apps/auth-api` renders them on the server in the visitor's language.
 */
export const messages = defineMessages("sitePage", {
  "sitePage.error.title": "This page could not load",
  "sitePage.error.body":
    "Check your connection and reload the page. If it still does not load, go back to the home page.",
  "sitePage.error.reload": "Reload page",
  "sitePage.error.home": "Back to home",
  "sitePage.join.title": "Join an HXBot server",
  "sitePage.join.description": "Open a private server invitation in HXBot.",
  "sitePage.join.eyebrow": "Private invitation",
  "sitePage.join.intro":
    "Open this invitation in HXBot. The app checks the server and asks you to confirm before it connects.",
  "sitePage.join.invalid":
    "This invitation link is not valid or is not complete. Ask the server owner for a new invitation.",
  "sitePage.join.open": "Open HXBot",
  // {browser} and {download} are links. Their text is browserLink and downloadLink.
  "sitePage.join.noApp": "No app? {browser} or {download}.",
  "sitePage.join.noAppMobile": "No app? {browser}.",
  "sitePage.join.browserLink": "Join in this browser",
  "sitePage.join.downloadLink": "download HXBot",
  // {open} is the label of the button that did not open HXBot.
  "sitePage.join.notOpened":
    "If HXBot is on this computer, start it, then press {open} again. If it is not, download it first.",
  // {open} is the label of the button above this note.
  "sitePage.join.mobile": "If HXBot is installed, tap {open}. You can also paste this link into Add server in the app.",
  "sitePage.join.email": "If the invitation came by email, sign in to HXBot with that email address.",
  // {name} is Slack or Discord on all the connect keys.
  "sitePage.connect.title": "Return to HXBot",
  "sitePage.connect.failedTitle": "The connection did not finish",
  "sitePage.connect.openApp": "Open HXBot",
  "sitePage.connect.tryAgainApp": "Try again in HXBot",
  "sitePage.connect.tryAgainBrowser": "Try again in browser",
  "sitePage.connect.doneInWebClient": "Your HXBot tab finishes the {name} connection. You can close this tab.",
  "sitePage.connect.doneInApp": "HXBot finishes the {name} connection on your computer.",
  "sitePage.connect.failure.cancelled": "The {name} connection was cancelled. Nothing changed.",
  "sitePage.connect.failure.expired": "The {name} sign-in expired. Start the connection again.",
  "sitePage.connect.failure.exchange": "{name} did not confirm the connection. Try again.",
  "sitePage.connect.failure.enterprise": "Connect one Slack workspace, not a whole organization.",
  "sitePage.connect.failure.takenSlack":
    "Another HXBot server already answers this Slack workspace. Disconnect it on that server, then try again.",
  "sitePage.connect.failure.takenDiscord":
    "Another HXBot server already answers this Discord server. Disconnect it on that server, then try again.",
  "sitePage.connect.failure.unavailable": "HXBot cannot connect to {name} now. Try again later.",
  "sitePage.connect.failure.tabClosed":
    "The HXBot tab that started the {name} connection did not answer. Open HXBot in your browser and connect {name} again.",
  "sitePage.connect.failure.failed": "{name} did not finish the connection. Try again.",
  // {marketplace}, {apps} and {connect} are the names of these screens and that button in the app.
  "sitePage.connect.restartHint": "In HXBot, open {marketplace}, then {apps}, then {name}, and select {connect}.",
  "sitePage.connect.notOpened":
    "Start HXBot, then try again. If HXBot is not on this computer, download it and connect {name} from the app.",
  "sitePage.openApp.title": "Nothing opened?",
  "sitePage.openApp.dismiss": "Not now",
  "sitePage.billing.pageTitle": "HXBot billing",
  "sitePage.billing.updatedTitle": "Billing updated",
  "sitePage.billing.updatedBody": "Go back to HXBot. You can close this page.",
  "sitePage.billing.cancelledTitle": "Checkout cancelled",
  "sitePage.billing.cancelledBody": "Nothing was charged. Go back to HXBot.",
  "sitePage.report.pageTitle": "Report a hosted site — HXBot",
  "sitePage.report.title": "Report a hosted site",
  "sitePage.report.intro": "Send a report about harmful or unlawful content on an HXBot address.",
  "sitePage.report.hostnameLabel": "Site address",
  "sitePage.report.hostnameMissing": "Enter the site address",
  "sitePage.report.reasonLabel": "Reason",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Malware",
  "sitePage.report.reason.abuse": "Abuse",
  "sitePage.report.reason.copyright": "Copyright",
  "sitePage.report.reason.other": "Other",
  "sitePage.report.detailsLabel": "Details",
  "sitePage.report.optional": "Optional",
  "sitePage.report.detailsPlaceholder": "What is wrong with this site?",
  "sitePage.report.send": "Send report",
  "sitePage.report.sending": "Sending…",
  "sitePage.report.tooMany": "Too many reports. Try again later.",
  "sitePage.report.sendFailed": "Could not send the report. Try again.",
  // {email} is the contact address. The page shows it as a link.
  "sitePage.report.writeTo": "You can also write to {email}.",
  "sitePage.report.sentTitle": "Report sent",
  "sitePage.report.sentBody": "Thanks. We received your report.",
  "sitePage.report.home": "Go to the home page",
  "sitePage.pricing.imageAlt": "Small team. Bright ideas. Three HXBot agents under a glass dome",
  // The text of the social image is English. Keep it as it is.
  "sitePage.teams.imageAlt": "Big plans. Better together. Two HXBot agents joined by a paper bridge",
  // The text of the social image is English. Keep it as it is.
  "sitePage.contact.imageAlt": "Small team. Always on it. HXBot agents around a paper planet",
  // {platform} is macOS, Windows or Linux.
  "sitePage.marketplace.downloadFor": "Download for {platform}",
  // The header, the menu, the footer and the last call to action of the public site.
  "sitePage.site.download": "Download",
  "sitePage.site.app": "App",
  "sitePage.site.primaryNavigation": "Primary navigation",
  "sitePage.site.siteMenu": "Site menu",
  "sitePage.site.openMenu": "Open menu",
  "sitePage.site.closeMenu": "Close menu",
  // The label of the list of the languages of the site.
  "sitePage.site.language": "Language",
  // The header button that opens the list of languages. {language} is the name of the page language in that language.
  "sitePage.site.language.current": "Language: {language}",
  // A badge on the newest article in the menu.
  "sitePage.site.latest": "Latest",
  "sitePage.site.home": "HXBot home",
  "sitePage.site.logo.menu": "Logo",
  "sitePage.site.logo.copyIcon": "Copy logo as SVG",
  "sitePage.site.logo.copyLockup": "Copy logo with name as SVG",
  "sitePage.site.logo.downloadAssets": "Download brand assets",
  "sitePage.site.logo.openBrand": "Open brand page",
  "sitePage.site.news": "News",
  "sitePage.site.news.summary": "What shipped, and why it matters.",
  "sitePage.site.news.index": "All news",
  "sitePage.site.guides": "Guides",
  "sitePage.site.guides.summary": "Learn HXBot one step at a time.",
  "sitePage.site.guides.index": "All guides",
  "sitePage.site.compare": "Compare",
  "sitePage.site.compare.summary": "How HXBot differs from other agent apps.",
  "sitePage.site.compare.index": "All comparisons",
  "sitePage.site.plugins": "Plugins",
  "sitePage.site.plugins.summary": "Apps and skills an agent can use.",
  "sitePage.site.plugins.index": "Browse plugins",
  "sitePage.site.resources": "Resources",
  "sitePage.site.resources.summary": "The source code of HXBot is open.",
  "sitePage.site.sourceCode": "Source code",
  "sitePage.site.download.description": "macOS, Windows and Linux",
  "sitePage.site.changelog": "Changelog",
  "sitePage.site.changelog.description": "What changed in each version",
  "sitePage.site.community": "Community",
  "sitePage.site.community.description": "Talk with us on Discord",
  "sitePage.site.documentation": "Documentation",
  "sitePage.site.documentation.description": "Set up and use HXBot",
  "sitePage.site.brand": "Brand",
  "sitePage.site.brand.description": "The logo as SVG and PNG",
  "sitePage.site.status": "Status",
  "sitePage.site.status.description": "Is the service up",
  "sitePage.site.forTeams": "For Teams",
  "sitePage.site.pricing": "Pricing",
  "sitePage.site.cta.title": "Meet your first teammate",
  "sitePage.site.cta.description":
    "Run Codex, Claude, Gemini, Grok or your own model with the plans you already pay for, each with its own workspace and context. Your work stays on your computer.",
  "sitePage.site.downloadHxBot": "Download HXBot",
  "sitePage.site.contact": "Contact",
  "sitePage.site.footer.description":
    "Persistent AI teammates on your own computer. Run Codex, Claude, Gemini, Grok, Muse Code, Pi or your own model with the plans you already pay for.",
  "sitePage.site.footer.navigation": "Footer navigation",
  "sitePage.site.footer.product": "Product",
  "sitePage.site.footer.providers": "Providers",
  "sitePage.site.footer.marketplace": "Marketplace",
  "sitePage.site.footer.teams": "Teams",
  "sitePage.site.footer.license": "License",
  "sitePage.site.footer.privacy": "Privacy policy",
  "sitePage.site.footer.terms": "Terms",
  "sitePage.site.footer.commercialLicense": "Commercial license",
  "sitePage.site.footer.troubleshooting": "Troubleshooting",
  "sitePage.site.footer.selfHosted": "Self-hosted server",
  "sitePage.site.footer.architecture": "Architecture",
  "sitePage.site.footer.contributing": "Contributing",
  "sitePage.site.footer.localModels": "Ollama and LM Studio",
  "sitePage.site.footer.allProviders": "All providers",
  "sitePage.site.footer.bestApps": "Best AI agent apps",
  // {year} is the current year. HX AI is a company name.
  "sitePage.site.footer.rights": "© {year} HX AI, All rights reserved.",
  "sitePage.site.footer.available": "Available for macOS, Windows, Linux, iOS and Android",
  // {love} is a heart icon. Its spoken name is the love key.
  "sitePage.site.footer.made": "Made with {love} in Poland",
  "sitePage.site.footer.love": "love",
});
