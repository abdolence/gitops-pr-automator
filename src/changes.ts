import { Config, SourceRepoConfig } from './config'
import { findVersions, FoundVersion } from './versions-finder'
import * as github from '@actions/github'
import * as core from '@actions/core'

export interface GitCommitParent {
  sha: string
  url: string
  html_url: string
}

export interface GitCommit {
  sha: string
  url: string
  html_url: string
  commit: {
    message: string
    author: {
      name: string
      email: string
    }
    url: string
  }
  author: {
    id: number
    login: string
    url: string
  }
  comments_url: string
  parents: GitCommitParent[]
}

export interface FoundChanges {
  sourceRepo: SourceRepoConfig
  repoVersionsToUpdate: FoundVersion[]
  currentVersion: string
  currentVersionSha: string
  commits: GitCommit[]
}

export async function findChangesInSourceRepo(
  config: Config,
  sourceRepo: SourceRepoConfig,
  octokit: ReturnType<typeof github.getOctokit>
): Promise<FoundChanges | undefined> {
  const repoVersions = await findVersions(config, sourceRepo.releaseFiles || [])
  core.info(
    `Found versions: [${repoVersions.map(ver => ver.version).join(', ')}] for '${sourceRepo.repo}'`
  )

  const [owner, repo] = sourceRepo.repo.split('/')

  console.debug(`Getting the current version of ${sourceRepo.repo}`)

  const { data: refData } = await octokit.rest.git.getRef({
    owner: owner,
    repo: repo,
    ref: sourceRepo.ref || 'heads/master'
  })

  const currentVersionSha = refData.object.sha
  let currentVersion = currentVersionSha

  if (
    config.versioning?.scheme === 'commit-tags-or-sha' ||
    config.versioning?.scheme === 'commit-tags-only'
  ) {
    console.debug(
      `Getting the current version tag of ${sourceRepo.repo} at ${currentVersionSha}`
    )

    // Check for git tags that match the current version SHA
    const { data: tagsData } = await octokit.rest.git.listMatchingRefs({
      owner: owner,
      repo: repo,
      ref: `tags`
    })

    const tagsMatchRegex = config.versioning.resolveTagsPattern
      ? new RegExp(config.versioning.resolveTagsPattern)
      : /refs\/tags\/v\d+\.\d+\.\d+/
    const suitableTags = tagsData
      .filter(tag => tag.object.sha === currentVersionSha)
      .filter(tag => tagsMatchRegex.test(tag.ref))
    console.debug(
      `Found: ${suitableTags.length}/${tagsData.length} suitable tags at ${currentVersionSha} according to the pattern: ${tagsMatchRegex.source} for ${sourceRepo.repo}`
    )

    if (suitableTags.length > 0) {
      currentVersion = suitableTags[0].ref.replace('refs/tags/', '')
    }

    if (
      config.versioning.scheme === 'commit-tags-only' &&
      suitableTags.length === 0
    ) {
      return undefined
    }
  }

  core.info(
    `Current version in ${sourceRepo.repo} is ${currentVersion}. Sha: ${currentVersionSha}`
  )

  const repoVersionsToUpdate = repoVersions.filter(
    ver => ver.version !== currentVersion
  )

  if (repoVersionsToUpdate.length === 0) {
    core.info(`No new version found for ${sourceRepo.repo}`)
    return undefined
  } else {
    core.info(`New version found for ${sourceRepo.repo}`)
    const relevantCommits: GitCommit[] = []
    if (!config.pullRequest.commitHistory?.disable) {
      for (const ver of repoVersionsToUpdate) {
        const commits = await octokit.paginate(
          octokit.rest.repos.compareCommits,
          {
            owner,
            repo,
            base: ver.version, // Older commit
            head: currentVersionSha // Newer commit
          },
          response => response.data.commits
        )

        for (const commit of commits) {
          if (
            config.pullRequest.commitHistory?.onlyMergeCommits &&
            commit.parents.length < 2 && !commit.commit.message.match(/#\d+/)
          ) {
            continue
          }
          if (!relevantCommits.find(c => c.sha === commit.sha)) {
            relevantCommits.push(commit as GitCommit)
          }
        }
      }
    }
    return {
      sourceRepo,
      repoVersionsToUpdate,
      currentVersion: currentVersion,
      currentVersionSha: currentVersionSha,
      commits: relevantCommits
    }
  }
}
