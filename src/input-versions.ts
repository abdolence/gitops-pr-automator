export interface IncomingVersion {
  repo: string
  pathId?: string
  newVersion: string
  newVersionSha: string
}

export function parseInputVersions(inputVersions: string): IncomingVersion[] {
  const result: IncomingVersion[] = []
  if (inputVersions) {
    const lines = inputVersions.split(';')
    for (const line of lines) {
      const parts = line.split('=')
      if (parts.length === 2) {
        const repoWithPath = parts[0].split(':')
        const repo = repoWithPath[0]
        const pathId = repoWithPath[1] || undefined
        const versionWithSha = parts[1].split(',')
        const newVersion = versionWithSha[0]
        const newVersionSha = versionWithSha[1]
        result.push({ repo, pathId, newVersion, newVersionSha })
      }
    }
  }
  return result
}
