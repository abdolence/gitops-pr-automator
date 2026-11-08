/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 *
 * The end-to-end test talks to GitHub: it needs `GITHUB_TOKEN` with write
 * access to this repository and `GITHUB_REPOSITORY`, both provided by
 * GitHub Actions in CI.
 */

import { jest } from '@jest/globals'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { run } from '../src/main.js'

describe('action', () => {
  let stdout: string[]

  beforeEach(() => {
    process.exitCode = undefined
    stdout = []
    jest.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      stdout.push(String(chunk))
      return true
    })
    process.env['INPUT_GITHUB-TOKEN'] =
      process.env.GITHUB_TOKEN ?? process.env.TEST_GITHUB_TOKEN ?? ''
    process.env['INPUT_CONFIG-OVERRIDE'] = `
          pullRequest:
            cleanupExistingAutomatorBranches: true
          `
    process.env['INPUT_VERSIONS'] =
      `abdolence/gitops-pr-automator:test-specific-path=v1.3.0,ef1250f9f2ab89ff8f9ce97e05c7ec8a1d29f32e`
  })

  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env['INPUT_CONFIG-PATH']
    process.exitCode = undefined
  })

  it('detects changes in source repos', async () => {
    await run()

    expect(stdout.filter(line => line.startsWith('::error::'))).toEqual([])
    expect(process.exitCode).toBeUndefined()
  }, 1000000)

  it('reports the failing path of an invalid config', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitops-main-'))
    try {
      const configPath = path.join(dir, 'config.yaml')
      await fs.writeFile(
        configPath,
        `
id: invalid-config
pullRequest:
  title: release
sourceRepos: not-a-list
`
      )
      process.env['INPUT_CONFIG-PATH'] = configPath
      process.env['INPUT_CONFIG-OVERRIDE'] = ''

      await run()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }

    const errors = stdout.filter(line => line.startsWith('::error::'))
    expect(process.exitCode).toBe(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('sourceRepos')
  })
})
