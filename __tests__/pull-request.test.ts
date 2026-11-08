import * as github from '@actions/github'

import {
  automatorBranchName,
  createPullRequest,
  isAutomatorBranch
} from '../src/pull-request.js'
import { Config } from '../src/config.js'
import { GitCommit } from '../src/changes.js'

type Octokit = ReturnType<typeof github.getOctokit>

interface FakePr {
  number: number
  created_at: string
  head: { ref: string }
}

interface Calls {
  closedPrs: number[]
  deletedRefs: string[]
  updatedPr: number[]
  createdBodies: string[]
}

function fakeOctokit(
  openPrs: FakePr[],
  branches: string[]
): { octokit: Octokit; calls: Calls } {
  const calls: Calls = {
    closedPrs: [],
    deletedRefs: [],
    updatedPr: [],
    createdBodies: []
  }
  const octokit = {
    paginate: async (
      route: (params: object) => Promise<{ data: unknown[] }>,
      params: object
    ) => (await route(params)).data,
    rest: {
      repos: {
        get: async () => ({ data: { default_branch: 'master' } }),
        listBranches: async () => ({ data: branches.map(name => ({ name })) }),
        merge: async () => ({}),
        createOrUpdateFileContents: async () => ({})
      },
      git: {
        getRef: async () => ({ data: { object: { sha: 'f'.repeat(40) } } }),
        createRef: async () => ({}),
        deleteRef: async ({ ref }: { ref: string }) => {
          calls.deletedRefs.push(ref)
        }
      },
      pulls: {
        list: async () => ({
          data: openPrs.map(pr => ({
            ...pr,
            html_url: `https://example.test/pull/${pr.number}`,
            id: pr.number,
            base: { ref: 'master' }
          }))
        }),
        update: async ({ pull_number }: { pull_number: number }) => {
          calls.closedPrs.push(pull_number)
        },
        create: async ({ body }: { body: string }) => {
          calls.createdBodies.push(body)
          return { data: { number: 99, id: 99, html_url: '', node_id: 'node' } }
        }
      },
      issues: {
        update: async ({ issue_number }: { issue_number: number }) => {
          calls.updatedPr.push(issue_number)
        },
        addLabels: async () => ({})
      }
    }
  } as unknown as Octokit
  return { octokit, calls }
}

function configWith(pullRequest: Partial<Config['pullRequest']>): Config {
  return {
    id: 'automator',
    pullRequest: { title: 'release', ...pullRequest },
    sourceRepos: []
  }
}

describe('createPullRequest', () => {
  beforeEach(() => {
    process.env['GITHUB_REPOSITORY'] = 'owner/gitops'
  })

  it('closes the oldest pull requests and keeps the newest ones open', async () => {
    const { octokit, calls } = fakeOctokit(
      [
        {
          number: 2,
          created_at: '2024-02-01T00:00:00Z',
          head: { ref: 'automator-2024-02-01T00-00-00-000Z' }
        },
        {
          number: 1,
          created_at: '2024-01-01T00:00:00Z',
          head: { ref: 'automator-2024-01-01T00-00-00-000Z' }
        },
        {
          number: 3,
          created_at: '2024-03-01T00:00:00Z',
          head: { ref: 'automator-2024-03-01T00-00-00-000Z' }
        },
        {
          number: 4,
          created_at: '2024-04-01T00:00:00Z',
          head: { ref: 'automator-staging-2024-04-01T00-00-00-000Z' }
        }
      ],
      []
    )

    await createPullRequest(
      configWith({ leaveOpenOnlyNumberOfPRs: 2 }),
      [],
      octokit
    )

    expect(calls.closedPrs).toEqual([1])
    expect(calls.deletedRefs).toEqual([
      'heads/automator-2024-01-01T00-00-00-000Z'
    ])
    expect(calls.updatedPr).toEqual([3])
  })

  it('cleans up stale automator branches but not those of open pull requests', async () => {
    const { octokit, calls } = fakeOctokit(
      [
        {
          number: 1,
          created_at: '2024-01-01T00:00:00Z',
          head: { ref: 'automator-2024-01-01T00-00-00-000Z' }
        }
      ],
      [
        'master',
        'feature/other',
        'automator-2024-01-01T00-00-00-000Z',
        'automator-2023-12-01T00-00-00-000Z',
        'automator-staging-2024-02-01T00-00-00-000Z'
      ]
    )

    await createPullRequest(
      configWith({
        alwaysCreateNew: true,
        cleanupExistingAutomatorBranches: true
      }),
      [],
      octokit
    )

    expect(calls.deletedRefs).toEqual([
      'heads/automator-2023-12-01T00-00-00-000Z'
    ])
  })

  it('lists a commit whose author has no GitHub account', async () => {
    const { octokit, calls } = fakeOctokit([], [])
    const sha = 'd'.repeat(40)

    await createPullRequest(
      configWith({}),
      [
        {
          sourceRepo: { repo: 'owner/source' },
          repoVersionsToUpdate: [],
          commits: [
            {
              sha,
              html_url: 'https://example.test/commit',
              commit: { message: 'Anonymous change', author: null },
              author: null,
              parents: []
            } as unknown as GitCommit
          ]
        }
      ],
      octokit
    )

    expect(calls.createdBodies).toHaveLength(1)
    expect(calls.createdBodies[0]).toContain(sha.slice(0, 8))
  })

  it('recognises the branch names it writes', () => {
    const name = automatorBranchName(
      'automator',
      new Date('2024-05-28T16:11:02.314Z')
    )

    expect(name).toBe('automator-2024-05-28T16-11-02-314Z')
    expect(isAutomatorBranch('automator', name)).toBe(true)
  })
})
