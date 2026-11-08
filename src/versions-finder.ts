import { Config, ReleaseFileConfig } from './config.js'
import * as glob from '@actions/glob'
import fs from 'fs/promises'

export interface FoundVersion {
  version: string
  versionSha?: string
}

export interface FoundVersionedFile {
  absolutePath: string
  gitPath: string
  content: string
  matchedRegex: RegExp
  matchedShaRegex?: RegExp
  pathId?: string
  /** The distinct versions the expression matches in the file, in file order. */
  versions: FoundVersion[]
}

export async function findVersions(
  config: Config,
  releaseFiles: ReleaseFileConfig[]
): Promise<FoundVersionedFile[]> {
  // One entry per file and expression: each expression replaces its own
  // matches, so an entry per file would drop all but one of them.
  const results: Map<string, FoundVersionedFile> = new Map()
  for (const fileConfig of releaseFiles) {
    const regexes = fileConfig.regex || config.regex || []
    const githubShaRegex =
      fileConfig.githubShaRegex || config.githubShaRegex || []
    console.debug(
      `Finding version changes in release files: ${fileConfig.path} with regex: ${regexes}. Id: ${fileConfig.id}. ShaRegex: ${githubShaRegex}`
    )
    const globber = await glob.create(
      fileConfig.ignore
        ? `${fileConfig.path}\n!${fileConfig.ignore}`
        : fileConfig.path
    )
    const fileResults = await globber.glob()

    for (const filePath of fileResults) {
      console.debug('Checking file: ', filePath)
      const fileContent = (await fs.readFile(filePath)).toString()
      for (const fileRegexStr of regexes) {
        const fileRegex = new RegExp(fileRegexStr, 'gm')
        const matchedVersions = new Set(
          Array.from(fileContent.matchAll(fileRegex), matched =>
            matched[0].trim()
          ).filter(version => version.length > 0)
        )
        if (matchedVersions.size === 0) {
          continue
        }

        let fileSha: string | undefined = undefined
        let matchedShaRegex: RegExp | undefined = undefined
        for (const shaRegexStr of githubShaRegex) {
          const shaRegex = new RegExp(shaRegexStr, 'gm')
          const shaMatch = fileContent.match(shaRegex)
          if (shaMatch && shaMatch[0] && shaMatch[0].trim().length > 0) {
            fileSha = shaMatch[0].trim()
            matchedShaRegex = shaRegex
            console.debug(`Found GitHub SHA: ${fileSha} in file: ${filePath}`)
            break
          }
        }

        const versions = Array.from(matchedVersions, version => ({
          version,
          versionSha: githubShaRegex.length > 0 ? fileSha : version
        }))
        console.debug(
          `Found versions: ${versions.map(v => v.version)} in a file: ${filePath}. Sha: ${fileSha}. PathId: ${fileConfig.id}`
        )
        const gitPath = filePath
          .replace(process.cwd(), '')
          .replace(/\\/g, '/')
          .replace(/^\//, '')

        results.set(`${filePath}\0${fileRegexStr}`, {
          absolutePath: filePath,
          gitPath,
          content: fileContent,
          matchedRegex: fileRegex,
          matchedShaRegex,
          pathId: fileConfig.id,
          versions
        })
      }
    }
  }
  return Array.from(results.values())
}
