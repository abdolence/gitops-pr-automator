import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import * as github from '@actions/github'

import { findChangesInSourceRepo } from '../src/changes.js'
import { Config } from '../src/config.js'

type Octokit = ReturnType<typeof github.getOctokit>

const HEAD_SHA = 'a'.repeat(40)
const TAG_OBJECT_SHA = 'b'.repeat(40)

function fakeOctokit(
  refs: { ref: string; object: { sha: string; type: string } }[],
  tagTargets: Record<string, { sha: string; type: string }> = {}
): Octokit {
  return {
    rest: {
      git: {
        getRef: async () => ({ data: { object: { sha: HEAD_SHA } } }),
        listMatchingRefs: async () => ({ data: refs }),
        getTag: async ({ tag_sha }: { tag_sha: string }) => ({
          data: { object: tagTargets[tag_sha] }
        })
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
      {
        ref: 'refs/tags/v1.0.0',
        object: { sha: 'c'.repeat(40), type: 'commit' }
      }
    ])

    const changes = await findChangesInSourceRepo(
      configWith('commit-tags-only'),
      sourceRepo,
      octokit,
      []
    )

    expect(changes).toBeUndefined()
  })

  it('matches an annotated tag to the commit it points at', async () => {
    const octokit = fakeOctokit(
      [
        {
          ref: 'refs/tags/v1.1.0',
          object: { sha: TAG_OBJECT_SHA, type: 'tag' }
        }
      ],
      { [TAG_OBJECT_SHA]: { sha: HEAD_SHA, type: 'commit' } }
    )

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
})
