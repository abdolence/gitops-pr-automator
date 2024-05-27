import { Config, MergeStrategies } from './config'
import * as github from '@actions/github'
import { RequestError } from '@octokit/request-error'
import { FoundChanges } from './changes'

type Octokit = ReturnType<typeof github.getOctokit>

export async function createPullRequest(
  config: Config,
  allRepoChanges: FoundChanges[],
  octokit: Octokit
) {
  const gitOpsRepo = github.context.repo
  const { data: repoData } = await octokit.rest.repos.get({
    owner: gitOpsRepo.owner,
    repo: gitOpsRepo.repo
  })
  const defaultBranch = repoData.default_branch

  console.info(
    `Default branch for ${gitOpsRepo.owner}/${gitOpsRepo.repo} is ${defaultBranch}`
  )

  const { data: refData } = await octokit.rest.git.getRef({
    owner: gitOpsRepo.owner,
    repo: gitOpsRepo.repo,
    ref: `heads/${defaultBranch}`
  })

  console.info(
    `Default branch ref for '${gitOpsRepo.owner}/${gitOpsRepo.repo}' is '${refData.object.sha}'`
  )

  const prTitle = config.pullRequest.title
  const prSummaryText = await generatePrSummaryText(config, allRepoChanges)

  // Find existing PRs
  const existingPRs = await findExistingPullRequests(config, octokit)

  if (existingPRs.length > 0) {
    console.info(`Found ${existingPRs.length} existing PRs for ${config.id}`)
    const pullRequest = existingPRs[0]

    // Merge the PR
    await octokit.rest.repos.merge({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      base: pullRequest.head.ref,
      head: pullRequest.base.ref
    })

    // Update the PR summary text
    await octokit.rest.issues.update({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      issue_number: pullRequest.number,
      body: prSummaryText
    })

    await commitChanges(
      octokit,
      pullRequest.head.ref,
      allRepoChanges,
      pullRequest.head.ref
    )
  } else {
    if (config.pullRequest.cleanupExistingAutomatorBranches) {
      await removeAllAutomatorBranches(config, octokit)
    }

    // Create a new branch name that includes the config id and the current timestamp to make it unique
    const newBranchName = `${config.id}-${new Date().toISOString().replace(/[:_\s\\.]/g, '-')}`
    const newBranchRef = `refs/heads/${newBranchName}`

    console.info(
      `No existing PRs found for '${config.id}-*'. Creating a new PR '${newBranchRef}'`
    )

    // Create a new branch
    await octokit.rest.git.createRef({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      ref: newBranchRef,
      sha: refData.object.sha
    })

    await commitChanges(octokit, newBranchName, allRepoChanges, defaultBranch)

    const response = await octokit.rest.pulls.create({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      title: prTitle,
      head: newBranchName,
      base: defaultBranch,
      body: prSummaryText
    })

    const pullRequest = response.data

    // Add labels to the PR
    await octokit.rest.issues.addLabels({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      issue_number: pullRequest.number,
      labels: config.pullRequest.githubLabels
    })

    if (config.pullRequest.enableAutoMerge) {
      await enableAutoMergeOnPR(
        octokit,
        pullRequest.node_id,
        config.pullRequest.enableAutoMerge
      )
    }
  }
}

async function getFileSha(
  octokit: Octokit,
  path: string,
  branchName: string
): Promise<string | undefined> {
  const gitOpsRepo = github.context.repo
  try {
    const response = await octokit.rest.repos.getContent({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      path,
      ref: branchName
    })
    return (response.data as any).sha // Type assertion is needed
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) return undefined // File not found
    throw error
  }
}

async function findExistingPullRequests(config: Config, octokit: Octokit) {
  const gitOpsRepo = github.context.repo

  const { data: pullRequests } = await octokit.rest.pulls.list({
    owner: gitOpsRepo.owner,
    repo: gitOpsRepo.repo,
    state: 'open'
  })

  return pullRequests.filter(pr => pr.head.ref.startsWith(`${config.id}-`))
}

interface FileToUpdate {
  gitPath: string
  content: string
  currentVersion: string
}

async function commitChanges(
  octokit: Octokit,
  branchName: string,
  allRepoChanges: FoundChanges[],
  compareBranch: string
): Promise<void> {
  console.info(`Committing changes to branch ${branchName}`)
  const gitOpsRepo = github.context.repo
  const filesToUpdate = new Map<string, FileToUpdate>()

  for (const repoChanges of allRepoChanges) {
    for (const version of repoChanges.repoVersionsToUpdate) {
      for (const file of version.files) {
        let fileToUpdate = filesToUpdate.get(file.gitPath)
        if (!fileToUpdate) {
          fileToUpdate = {
            gitPath: file.gitPath,
            content: file.content,
            currentVersion: repoChanges.currentVersion
          }
          filesToUpdate.set(file.gitPath, fileToUpdate)
        }
        fileToUpdate.content = fileToUpdate.content.replaceAll(
          file.matchedRegex,
          repoChanges.currentVersion
        )
      }
    }
  }

  for (const fileToUpdate of filesToUpdate.values()) {
    const fileSha = await getFileSha(
      octokit,
      fileToUpdate.gitPath,
      compareBranch
    )
    console.debug(
      `Updating file ${fileToUpdate.gitPath} with new version ${fileToUpdate.currentVersion} with sha ${fileSha}`
    )

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      path: fileToUpdate.gitPath,
      message: `chore(release): Update ${fileToUpdate.gitPath} to ${fileToUpdate.currentVersion}`,
      content: Buffer.from(fileToUpdate.content).toString('base64'),
      branch: branchName,
      sha: fileSha
    })
  }
}

async function removeAllAutomatorBranches(
  config: Config,
  octokit: Octokit
): Promise<void> {
  const gitOpsRepo = github.context.repo

  const { data: branches } = await octokit.rest.repos.listBranches({
    owner: gitOpsRepo.owner,
    repo: gitOpsRepo.repo
  })

  const automatorBranches = branches.filter(branch =>
    branch.name.startsWith(`${config.id}/`)
  )

  for (const branch of automatorBranches) {
    try {
      await octokit.rest.git.deleteRef({
        owner: gitOpsRepo.owner,
        repo: gitOpsRepo.repo,
        ref: `heads/${branch.name}`
      })
    } catch (error) {
      console.error(`Failed to delete branch ${branch}`)
      console.error(error)
    }
  }
}

async function enableAutoMergeOnPR(
  octokit: Octokit,
  pullRequestId: string,
  mergeMethod: MergeStrategies
): Promise<void> {
  try {
    // Enable auto-merge
    await octokit.graphql(
      `
      mutation enableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $pullRequestId,
          mergeMethod: $mergeMethod
        }) {
          clientMutationId
        }
      }
    `,
      { pullRequestId: pullRequestId, mergeMethod: mergeMethod.toUpperCase() }
    )

    console.log(`Auto-merge enabled for PR #${pullRequestId}`)
  } catch (error) {
    console.error('Error enabling auto-merge:', error)
    throw error // Or handle the error gracefully
  }
}

async function generatePrSummaryText(
  config: Config,
  allRepoChanges: FoundChanges[]
): Promise<string> {
  let prSummaryText =
    config.pullRequest.pullRequestComment || 'GitOps Automator PR Summary'
  prSummaryText += '\n\n'
  for (const repoChanges of allRepoChanges) {
    prSummaryText += `## ${repoChanges.sourceRepo.repo}\n\n`
    prSummaryText += `### Versions:\n\n`
    prSummaryText += `\n\nUpdated to: [${repoChanges.currentVersion.slice(0, 9)}](https://github.com/${repoChanges.sourceRepo.repo}/commits/${repoChanges.currentVersion}).\nExisting versions:\n\n`

    for (const version of repoChanges.repoVersionsToUpdate) {
      prSummaryText += `- [${version.version.slice(0, 9)}](https://github.com/${repoChanges.sourceRepo.repo}/commits/${version.version})\n`
    }

    prSummaryText += `\n\n### Changes:\n\n`
    for (const commit of repoChanges.commits) {
      const shortMessage = commit.commit.message.split('\n')[0]
      prSummaryText += `- [${commit.sha.slice(0, 8)}](${commit.html_url}) ${shortMessage} by @${commit.author.login}\n`
    }
  }
  return prSummaryText
}
