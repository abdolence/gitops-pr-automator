/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as main from '../src/main'

// Mock the action's main function
const runMock = jest.spyOn(main, 'run')

// Mock the GitHub Actions core library
let getInputMock: jest.SpiedFunction<typeof core.getInput>

describe('action', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
  })

  it('detects changes in source repos', async () => {
    // Set the action's inputs as return values from core.getInput()
    getInputMock.mockImplementation(name => {
      switch (name) {
        case 'github-token':
          return (
            process.env.GITHUB_TOKEN ||
            process.env.TEST_GITHUB_TOKEN ||
            'mock-github-token'
          )
        default:
          return ''
      }
    })

    await main.run()
    expect(runMock).toHaveReturned()
  }, 1000000)
})
