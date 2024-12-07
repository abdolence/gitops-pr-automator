import { Config, SourceRepoConfig } from './config'
import { findVersions, FoundVersionedFile } from './versions-finder'
import * as github from '@actions/github'
import * as core from '@actions/core'
import { IncomingVersion } from './input-versions'

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
      date: string
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

export interface RepoVersionToUpdate {
  existingVersion: string
  existingVersionSha?: string
  newVersion: string
  newVersionSha?: string
  file: FoundVersionedFile
}

export interface FoundChanges {
  sourceRepo: SourceRepoConfig
  repoVersionsToUpdate: RepoVersionToUpdate[]
  commits: GitCommit[]
}

export async function findChangesInSourceRepo(
  config: Config,
  sourceRepo: SourceRepoConfig,
  octokit: ReturnType<typeof github.getOctokit>,
  overrideVersions: IncomingVersion[]
): Promise<FoundChanges | undefined> {
  const foundVersionFiles = await findVersions(
    config,
    sourceRepo.releaseFiles || []
  )
  core.info(
    `Found versions: [${foundVersionFiles.map(ver => `${ver.gitPath}:${ver.version}`).join(', ')}] for '${sourceRepo.repo}'`
  )

  const [owner, repo] = sourceRepo.repo.split('/')

  console.debug(`Getting the head SHA of ${sourceRepo.repo}`)

  const { data: refData } = await octokit.rest.git.getRef({
    owner: owner,
    repo: repo,
    ref: sourceRepo.ref || 'heads/master'
  })

  const headVersionSha = refData.object.sha
  console.debug(`Head SHA of ${sourceRepo.repo} is ${headVersionSha}`)

  const suitableTagsMap = new Map<string, string>()

  if (
    config.versioning?.scheme === 'commit-tags-or-sha' ||
    config.versioning?.scheme === 'commit-tags-only'
  ) {
    console.debug(
      `Getting the current version tag of ${sourceRepo.repo} at ${headVersionSha}`
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
    const suitableTagsList = tagsData
      .filter(tag => tagsMatchRegex.test(tag.ref))
      .map(tag => {
        return {
          ver: tag.ref.replace('refs/tags/', ''),
          sha: tag.object.sha
        }
      })

    for (const tag of suitableTagsList) {
      suitableTagsMap.set(tag.sha, tag.ver)
    }
  }

  const repoVersions: RepoVersionToUpdate[] = foundVersionFiles
    .map(foundVer => {
      const { newVersion, newVersionSha } = getNewVersionFor(
        sourceRepo,
        foundVer,
        headVersionSha,
        overrideVersions,
        suitableTagsMap
      )
      return {
        existingVersion: foundVer.version,
        existingVersionSha: foundVer.versionSha,
        newVersion: newVersion,
        newVersionSha: newVersionSha,
        file: foundVer
      }
    })
    .filter(ver => ver.existingVersion !== ver.newVersion)

  core.info(
    `Found versions to update: [${repoVersions.map(ver => `${ver.file.gitPath}:${ver.existingVersion} -> ${ver.newVersion}`).join(', ')}] for '${sourceRepo.repo}'`
  )

  if (repoVersions.length === 0) {
    core.info(`No new version found for ${sourceRepo.repo}`)
    return undefined
  } else {
    core.info(`New version found for ${sourceRepo.repo}`)
    const relevantCommits: GitCommit[] = []
    if (!config.pullRequest.commitHistory?.disable) {
      for (const ver of repoVersions) {
        if (
          ver.existingVersionSha === undefined ||
          ver.newVersionSha === undefined
        ) {
          continue
        }
        const commits = await octokit.paginate(
          octokit.rest.repos.compareCommits,
          {
            owner,
            repo,
            base: ver.existingVersionSha, // Older commit
            head: ver.newVersionSha // Newer commit
          },
          response => response.data.commits
        )

        for (const commit of commits) {
          if (
            config.pullRequest.commitHistory?.onlyMergeCommits &&
            commit.parents.length < 2 &&
            !commit.commit.message.match(/#\d+/)
          ) {
            continue
          }
          if (!relevantCommits.find(c => c.sha === commit.sha)) {
            relevantCommits.push(commit as GitCommit)
          }
        }
      }
      relevantCommits.sort((a, b) => {
        if (a.commit.author.date > b.commit.author.date) {
          return -1
        } else if (a.commit.author.date < b.commit.author.date) {
          return 1
        }
        return 0
      })
    }
    return {
      sourceRepo,
      repoVersionsToUpdate: repoVersions,
      commits: relevantCommits
    }
  }
}

function getNewVersionFor(
  sourceRepo: SourceRepoConfig,
  foundVer: FoundVersionedFile,
  headVersionSha: string,
  overrideVersions: IncomingVersion[],
  suitableTagsMap: Map<string, string>
): { newVersion: string; newVersionSha: string } {
  const override = overrideVersions.find(
    ov =>
      ov.repo === sourceRepo.repo &&
      (ov.pathId === foundVer.pathId || !ov.pathId)
  )

  if (override) {
    console.info(
      `Overriding version for ${sourceRepo.repo} with ${override.newVersion} for ${foundVer.gitPath}`
    )
    return {
      newVersion: override.newVersion,
      newVersionSha: override.newVersionSha
    }
  } else {
    const tagsByHeadSha = suitableTagsMap.get(headVersionSha)
    if (tagsByHeadSha) {
      console.info(
        `Overriding version for ${sourceRepo.repo} with ${tagsByHeadSha} for ${foundVer.gitPath}`
      )
      return { newVersion: tagsByHeadSha, newVersionSha: headVersionSha }
    } else {
      console.info(
        `Using head version for ${sourceRepo.repo} for ${foundVer.gitPath}`
      )
      return { newVersion: headVersionSha, newVersionSha: headVersionSha }
    }
  }
}
