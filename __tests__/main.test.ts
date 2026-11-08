/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import { run } from '../src/main.js'

describe('action', () => {
  beforeEach(() => {
    process.env['INPUT_GITHUB-TOKEN'] =
      process.env.GITHUB_TOKEN ||
      process.env.TEST_GITHUB_TOKEN ||
      'mock-github-token'
    process.env['INPUT_CONFIG-OVERRIDE'] = `
          pullRequest:
            cleanupExistingAutomatorBranches: true
          `
    process.env['INPUT_VERSIONS'] =
      `abdolence/gitops-pr-automator:test-specific-path=v1.3.0,ef1250f9f2ab89ff8f9ce97e05c7ec8a1d29f32e`
  })

  it('detects changes in source repos', async () => {
    await expect(run()).resolves.toBeUndefined()
  }, 1000000)
})
