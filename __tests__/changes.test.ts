import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import * as github from '@actions/github'

import { findChangesInSourceRepo } from '../src/changes.js'
import { Config } from '../src/config.js'

type Octokit = ReturnType<typeof github.getOctokit>

const HEAD_SHA = 'a'.repeat(40)

function fakeOctokit(
  tags: { name: string; commit: { sha: string } }[],
  comparisons: string[] = []
): Octokit {
  return {
    paginate: async (
      route: (params: object) => Promise<{ data: unknown }>,
      params: object,
      mapResponse?: (response: { data: unknown }) => unknown[]
    ) => {
      const response = await route(params)
      return mapResponse ? mapResponse(response) : response.data
    },
    rest: {
      git: {
        getRef: async () => ({ data: { object: { sha: HEAD_SHA } } })
      },
      repos: {
        listTags: async () => ({ data: tags }),
        compareCommits: async ({
          base,
          head
        }: {
          base: string
          head: string
        }) => {
          comparisons.push(`${base}..${head}`)
          return { data: { commits: [] } }
        }
      }
    }
  } as unknown as Octokit
}

function configWith(scheme: 'commit-tags-only' | 'commit-tags-or-sha'): Config {
  return {
    id: 'test',
    pullRequest: { title: 'release', commitHistory: { disable: true } },
    versioning: { scheme },
    regex: ['v\\d+\\.\\d+\\.\\d+'],
    sourceRepos: []
  }
}

const sourceRepo = {
  repo: 'owner/source',
  releaseFiles: [{ path: 'app.yaml' }]
}

describe('findChangesInSourceRepo', () => {
  const originalCwd = process.cwd()
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'gitops-changes-'))
    )
    await fs.writeFile(path.join(workspace, 'app.yaml'), 'image: v1.0.0\n')
    process.chdir(workspace)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('leaves a file alone with commit-tags-only when no tag points at the head', async () => {
    const octokit = fakeOctokit([
      { name: 'v1.0.0', commit: { sha: 'c'.repeat(40) } }
    ])

    const changes = await findChangesInSourceRepo(
      configWith('commit-tags-only'),
      sourceRepo,
      octokit,
      []
    )

    expect(changes).toBeUndefined()
  })

  it('updates to the tag that points at the head commit', async () => {
    const octokit = fakeOctokit([{ name: 'v1.1.0', commit: { sha: HEAD_SHA } }])

    const changes = await findChangesInSourceRepo(
      configWith('commit-tags-or-sha'),
      sourceRepo,
      octokit,
      []
    )

    expect(changes?.repoVersionsToUpdate.map(v => v.newVersion)).toEqual([
      'v1.1.0'
    ])
  })

  it('updates a file in which an earlier match is stale but the last is current', async () => {
    await fs.writeFile(
      path.join(workspace, 'app.yaml'),
      'a: v1.0.0\nb: v1.1.0\n'
    )
    const octokit = fakeOctokit([{ name: 'v1.1.0', commit: { sha: HEAD_SHA } }])

    const changes = await findChangesInSourceRepo(
      configWith('commit-tags-or-sha'),
      sourceRepo,
      octokit,
      []
    )

    expect(
      changes?.repoVersionsToUpdate.map(v => [v.existingVersion, v.newVersion])
    ).toEqual([['v1.0.0', 'v1.1.0']])
  })

  it('leaves a file alone when every match is current', async () => {
    await fs.writeFile(
      path.join(workspace, 'app.yaml'),
      'a: v1.1.0\nb: v1.1.0\n'
    )
    const octokit = fakeOctokit([{ name: 'v1.1.0', commit: { sha: HEAD_SHA } }])

    const changes = await findChangesInSourceRepo(
      configWith('commit-tags-or-sha'),
      sourceRepo,
      octokit,
      []
    )

    expect(changes).toBeUndefined()
  })

  it('compares each pair of commits once when expressions share a SHA', async () => {
    const currentSha = 'b'.repeat(40)
    await fs.writeFile(
      path.join(workspace, 'app.yaml'),
      `a: v1.0.0\nb: chart-1.0.0\nsha: ${currentSha}\n`
    )
    const comparisons: string[] = []
    const octokit = fakeOctokit(
      [{ name: 'v1.1.0', commit: { sha: HEAD_SHA } }],
      comparisons
    )

    await findChangesInSourceRepo(
      {
        ...configWith('commit-tags-or-sha'),
        pullRequest: { title: 'release' },
        regex: ['v\\d+\\.\\d+\\.\\d+', 'chart-\\d+\\.\\d+\\.\\d+'],
        githubShaRegex: ['(?<=sha: )[a-f0-9]{40}']
      },
      sourceRepo,
      octokit,
      []
    )

    expect(comparisons).toEqual([`${currentSha}..${HEAD_SHA}`])
  })
})
