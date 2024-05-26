import { SourceRepoConfig } from './config'
import { findVersions, FoundVersion } from './versions-finder'
import * as github from '@actions/github'
import * as core from '@actions/core'

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
}

export interface FoundChanges {
  sourceRepo: SourceRepoConfig
  repoVersionsToUpdate: FoundVersion[]
  currentVersion: string
  commits: GitCommit[]
}

export async function findChangesInSourceRepo(
  sourceRepo: SourceRepoConfig,
  octokit: ReturnType<typeof github.getOctokit>
): Promise<FoundChanges | undefined> {
  const repoVersions = await findVersions(sourceRepo.releaseFiles || [])
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

  const currentVersion = refData.object.sha

  core.info(`Current version in ${sourceRepo.repo} is ${currentVersion}`)

  const repoVersionsToUpdate = repoVersions.filter(
    ver => ver.version !== currentVersion
  )

  if (repoVersionsToUpdate.length === 0) {
    core.info(`No new version found for ${sourceRepo.repo}`)
    return undefined
  } else {
    core.info(`New version found for ${sourceRepo.repo}`)
    const relevantCommits: GitCommit[] = []
    for (const ver of repoVersionsToUpdate) {
      const commits = await octokit.paginate(
        octokit.rest.repos.compareCommits,
        {
          owner,
          repo,
          base: ver.version, // Older commit
          head: currentVersion // Newer commit
        },
        response => response.data.commits
      )

      for (const commit of commits) {
        if (!relevantCommits.find(c => c.sha === commit.sha)) {
          relevantCommits.push(commit as GitCommit)
        }
      }
    }
    return {
      sourceRepo,
      repoVersionsToUpdate,
      currentVersion,
      commits: relevantCommits
    }
  }
}
