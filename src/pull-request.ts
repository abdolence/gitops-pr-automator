import { Config } from './config'
import * as github from '@actions/github'
import { RequestError } from '@octokit/request-error'
import { FoundChanges } from './changes'

type Octokit = ReturnType<typeof github.getOctokit>;

export async function createPullRequest(config: Config, allRepoChanges: FoundChanges[], octokit: Octokit) {
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

  // Find existing PRs
  const existingPRs = await findExistingPullRequests(config, octokit);

  let pullRequest = undefined;
  if(existingPRs.length > 0) {
    console.info(`Found ${existingPRs.length} existing PRs for ${config.id}`);
    pullRequest = existingPRs[0];

    // Merge the PR
    await octokit.rest.repos.merge({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      base: pullRequest.base.ref,
      head: pullRequest.head.ref,
    });


  }
  else {
    console.info(`No existing PRs found for ${config.id}. Creating a new PR`);
    // Create a new branch name that includes the config id and the current timestamp to make it unique
    const newBranchName = `${config.id}/${new Date().toISOString().replace(/[:_\s\\.]/g, '-')}`;
    const newBranchRef = `refs/heads/${newBranchName}`;

    // Create a new branch
    await octokit.rest.git.createRef({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      ref: newBranchRef,
      sha: refData.object.sha,
    });

    await commitChanges(octokit, newBranchName, allRepoChanges);

  }

  // const newBranchName = `${config.id}/${new Date().toISOString()}`;
  // const newBranchRef = `refs/heads/${newBranchName}`;
  // await octokit.rest.git.createRef({
  //   owner: gitOpsRepo.owner,
  //   repo: gitOpsRepo.repo,
  //   ref: newBranchRef,
  //   sha: refData.object.sha,
  // });

  // 4. Commit Changes (Example)
  // const path = 'path/to/your/file.txt'; // Path to file you want to change
  // const content = 'New content for the file';
  //
  // const fileSha = await getFileSha(octokit, owner, repo, path);
  // await octokit.rest.repos.createOrUpdateFileContents({
  //   owner,
  //   repo,
  //   path,
  //   message: 'Commit message',
  //   content: Buffer.from(content).toString('base64'),
  //   branch: newBranchName,
  //   sha: fileSha // Only necessary if updating an existing file
  // });
  //
  // // 5. Create Pull Request
  // await octokit.rest.pulls.create({
  //   owner,
  //   repo,
  //   title: 'Title of your pull request',
  //   head: newBranchName,
  //   base: defaultBranch,
  //   body: 'Description of your pull request',
  // });
}


async function getFileSha(octokit: Octokit, path: string) {
  const gitOpsRepo = github.context.repo;
  try {
    const response = await octokit.rest.repos.getContent({ owner: gitOpsRepo.owner, repo: gitOpsRepo.repo, path });
    return (response.data as any).sha; // Type assertion is needed
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) return undefined; // File not found
    throw error;
  }
}

async function findExistingPullRequests(config: Config, octokit: Octokit) {
  const gitOpsRepo = github.context.repo;

  const { data: pullRequests } = await octokit.rest.pulls.list({
    owner: gitOpsRepo.owner,
    repo: gitOpsRepo.repo,
    state: "open"
  });

  const filteredPRs = pullRequests.filter(pr =>
    pr.head.ref.startsWith(`${config.id}/`)
  );

  return filteredPRs;
}

async function commitChanges(octokit: Octokit, branchName: string, allRepoChanges: FoundChanges[]) {
  console.info(`Committing changes to branch ${branchName}`);
  const gitOpsRepo = github.context.repo;

  for (const repoChanges of allRepoChanges) {
    for (const version of repoChanges.repoVersionsToUpdate) {
      for (const file of version.files) {
        const updatedContent = file.content.replaceAll(file.matchedRegex, repoChanges.currentVersion);

        const fileSha = await getFileSha(octokit, file.gitPath);
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: gitOpsRepo.owner,
          repo: gitOpsRepo.repo,
          path: file.gitPath,
          message: `Update ${repoChanges.sourceRepo.repo} version from ${version.version} to ${repoChanges.currentVersion}`,
          content: Buffer.from(updatedContent).toString('base64'),
          branch: branchName,
          sha: fileSha,
        });
      }
    }
  }
}
