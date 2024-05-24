export interface ReleaseFileConfig {
  path: string;
  ignore?: string; // Optional for excluding certain files/paths
  regex: string;
}

export interface SourceRepoConfig {
  repo: string;
  releaseFiles?: ReleaseFileConfig[];
}

export interface PullRequestAuthorConfig {
  username: string;
  email: string;
}

export interface Config {
  pullRequest: {
    title: string;
    githubLabel: string;
    additionalLabels?: string[];
    enableAutoMerge?: boolean;
    pullRequestComment?: string;
    includePullRequestsHistory?: boolean;
    author: PullRequestAuthorConfig;
  };
  releaseFiles?: ReleaseFileConfig[];
  sourceRepos: SourceRepoConfig[];
}
