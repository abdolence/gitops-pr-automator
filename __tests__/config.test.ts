import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { loadConfigFromYaml } from '../src/config.js'

describe('loadConfigFromYaml', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitops-config-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('resolves YAML merge keys', async () => {
    const configPath = path.join(dir, 'config.yaml')
    await fs.writeFile(
      configPath,
      `
id: merge-keys
pullRequest:
  title: release
sourceRepos:
  - &base
    repo: owner/first
    ref: heads/main
  - <<: *base
    repo: owner/second
`
    )

    const config = await loadConfigFromYaml(configPath)

    expect(config.sourceRepos).toEqual([
      { repo: 'owner/first', ref: 'heads/main' },
      { repo: 'owner/second', ref: 'heads/main' }
    ])
  })
})
