// The GitHub App that the built-in GitHub connection signs in to.
//
// `bun scripts/create-github-app.ts` creates the app and prints its Client ID. A Client ID is
// public: device flow and refresh need nothing else, and the client secret never ships.

/** The GitHub App "HxBotGit" of `nightly-labs`. With no Client ID, the connection is not offered. */
// HXBot: not the upstream project's GitHub App. With no Client ID the GitHub connection is not offered;
// HXBOT_GITHUB_CLIENT_ID and HXBOT_GITHUB_APP_SLUG can name a GitHub App of 弘犀智能.
const GITHUB_APP_CLIENT_ID = "";
const GITHUB_APP_SLUG = ""; // HXBot: not the upstream app "hxbotgit"

export interface GitHubAppConfig {
  clientId: string;
  slug: string;
}

/** The configured app, or null. `HXBOT_GITHUB_CLIENT_ID` and `HXBOT_GITHUB_APP_SLUG` override it. */
export function githubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig | null {
  const clientId = env.HXBOT_GITHUB_CLIENT_ID?.trim() || GITHUB_APP_CLIENT_ID;
  const slug = env.HXBOT_GITHUB_APP_SLUG?.trim() || GITHUB_APP_SLUG;
  if (!/^[A-Za-z0-9.]+$/u.test(clientId) || !/^[a-z0-9-]+$/u.test(slug)) return null;
  return { clientId, slug };
}
