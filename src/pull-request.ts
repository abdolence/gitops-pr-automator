import { Config } from './config'
import * as github from '@actions/github'
import { RequestError } from '@octokit/request-error'
import { FoundChanges } from './changes'

export async function createPullRequest(config: Config, allRepoChanges: FoundChanges[], octokit: ReturnType<typeof github.getOctokit>) {
  const gitOpsRepo = github.context.repo;
  const { data: repoData } = await octokit.rest.repos.get({ owner: gitOpsRepo.owner, repo: gitOpsRepo.repo });
  const defaultBranch = repoData.default_branch;

  console.info(`Default branch for ${gitOpsRepo.owner}/${gitOpsRepo.repo} is ${defaultBranch}`);

  const { data: refData } = await octokit.rest.git.getRef({
    owner: gitOpsRepo.owner,
    repo: gitOpsRepo.repo,
    ref: `heads/${defaultBranch}`,
  });

  console.info(`Default branch ref for ${gitOpsRepo.owner}/${gitOpsRepo.repo} is ${refData.object.sha}`);

  // const newBranchName = `gitops-pr-automator-${new Date().toISOString()}`;
  // const newBranchRef = `refs/heads/${newBranchName}`;
  // await octokit.rest.git.createRef({
  //   owner: gitOpsRepo.owner,
  //   repo: gitOpsRepo.repo,
  //   ref: newBranchRef,
  //   sha: refData.object.sha,
  // });
}


async function getFileSha(octokit: ReturnType<typeof github.getOctokit>, path: string) {
  const gitOpsRepo = github.context.repo;
  try {
    const response = await octokit.rest.repos.getContent({ owner: gitOpsRepo.owner, repo: gitOpsRepo.repo, path });
    return (response.data as any).sha; // Type assertion is needed
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) return undefined; // File not found
    throw error;
  }
}
