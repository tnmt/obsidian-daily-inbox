export interface GitHubSettings {
  /** GitHub login whose commits, pull requests and issues are shown. */
  username: string;
  /** Personal access token used for the search API. */
  token: string;
  /** Commits mostly repeat the merged pull requests they belong to, so they are opt-in. */
  includeCommits: boolean;
}

export const DEFAULT_GITHUB_SETTINGS: GitHubSettings = {
  username: "",
  token: "",
  includeCommits: false,
};

// The login is interpolated into a search query, so anything that could add a
// qualifier (spaces, colons) makes the source unavailable instead.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export function isGitHubConfigured(settings: GitHubSettings): boolean {
  return LOGIN.test(settings.username.trim()) && settings.token.trim() !== "";
}
