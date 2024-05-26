import { Config } from './config'
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
    `Default branch ref for ${gitOpsRepo.owner}/${gitOpsRepo.repo} is ${refData.object.sha}`
  )

  const prTitle = config.pullRequest.title
  const prSummaryText = await generatePrSummaryText(config, allRepoChanges)

  // Find existing PRs
  const existingPRs = await findExistingPullRequests(config, octokit)

  let pullRequest = undefined
  if (existingPRs.length > 0) {
    console.info(`Found ${existingPRs.length} existing PRs for ${config.id}`)
    pullRequest = existingPRs[0]

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
  } else {
    await removeAllAutomatorBranches(config, octokit)

    console.info(`No existing PRs found for ${config.id}. Creating a new PR`)
    // Create a new branch name that includes the config id and the current timestamp to make it unique
    const newBranchName = `${config.id}/${new Date().toISOString().replace(/[:_\s\\.]/g, '-')}`
    const newBranchRef = `refs/heads/${newBranchName}`

    // Create a new branch
    await octokit.rest.git.createRef({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      ref: newBranchRef,
      sha: refData.object.sha
    })

    await commitChanges(octokit, newBranchName, allRepoChanges)

    const response = await octokit.rest.pulls.create({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      title: prTitle,
      head: newBranchName,
      base: defaultBranch,
      body: prSummaryText
    })

    pullRequest = response.data
  }

  // Add labels to the PR
  await octokit.rest.issues.addLabels({
    owner: gitOpsRepo.owner,
    repo: gitOpsRepo.repo,
    issue_number: pullRequest.number,
    labels: config.pullRequest.githubLabels
  })

  if (config.pullRequest.enableAutoMerge) {
    await enableAutoMerge(
      octokit,
      pullRequest.number,
      config.pullRequest.enableAutoMerge
    )
  }
}

async function getFileSha(
  octokit: Octokit,
  path: string
): Promise<string | undefined> {
  const gitOpsRepo = github.context.repo
  try {
    const response = await octokit.rest.repos.getContent({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      path
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

  return pullRequests.filter(pr => pr.head.ref.startsWith(`${config.id}/`))
}

interface FileToUpdate {
  gitPath: string
  content: string
  currentVersion: string
}

async function commitChanges(
  octokit: Octokit,
  branchName: string,
  allRepoChanges: FoundChanges[]
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
    const fileSha = await getFileSha(octokit, fileToUpdate.gitPath)
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

async function enableAutoMerge(
  octokit: Octokit,
  pullNumber: number,
  mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge'
) {
  const gitOpsRepo = github.context.repo
  try {
    const response = await octokit.rest.pulls.update({
      owner: gitOpsRepo.owner,
      repo: gitOpsRepo.repo,
      pull_number: pullNumber,
      auto_merge: true,
      merge_method: mergeMethod
    })

    console.log('Auto-merge enabled:', response.data.auto_merge)
  } catch (error) {
    console.error('Error enabling auto-merge:', error)
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
      prSummaryText += `- [${commit.sha.slice(0, 8)}](${commit.html_url}) ${commit.commit.message} by @${commit.author.login}\n`
    }
  }
  return prSummaryText
}
