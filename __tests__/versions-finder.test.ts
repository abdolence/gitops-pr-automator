import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { findVersions } from '../src/versions-finder.js'
import { Config } from '../src/config.js'

describe('findVersions', () => {
  const originalCwd = process.cwd()
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'gitops-versions-'))
    )
    process.chdir(workspace)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('skips the files matched by the ignore pattern of a release file', async () => {
    await fs.mkdir(path.join(workspace, 'vendor'))
    await fs.writeFile(path.join(workspace, 'app.yaml'), 'image: v1.0.0\n')
    await fs.writeFile(
      path.join(workspace, 'vendor', 'lib.yaml'),
      'image: v1.0.0\n'
    )
    const config: Config = {
      id: 'test',
      pullRequest: { title: 'release' },
      sourceRepos: [],
      regex: ['v\\d+\\.\\d+\\.\\d+']
    }

    const found = await findVersions(config, [
      { path: '**/*.yaml', ignore: 'vendor/**' }
    ])

    expect(found.map(file => file.gitPath)).toEqual(['app.yaml'])
  })
})
