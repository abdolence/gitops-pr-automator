import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { generateSummaryArtifacts } from '../src/summary-artifacts.js'
import { Config } from '../src/config.js'

describe('generateSummaryArtifacts', () => {
  const originalCwd = process.cwd()
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'gitops-summary-'))
    )
    process.chdir(workspace)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('writes summary files named without a directory and creates nested ones', async () => {
    const config: Config = {
      id: 'test',
      pullRequest: { title: 'release' },
      sourceRepos: [],
      artifacts: {
        summaryMarkdownAs: 'summary.md',
        summaryJsonAs: 'out/nested/summary.json'
      }
    }

    await generateSummaryArtifacts(config, [])

    await expect(fs.access('summary.md')).resolves.toBeUndefined()
    await expect(
      fs.access(path.join('out', 'nested', 'summary.json'))
    ).resolves.toBeUndefined()
  })
})
