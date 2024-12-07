import { Config, ReleaseFileConfig } from './config'
import * as glob from '@actions/glob'
import fs from 'fs/promises'

export interface FoundVersionedFile {
  absolutePath: string
  gitPath: string
  content: string
  matchedRegex: RegExp
  matchedShaRegex?: RegExp
  pathId?: string
  version: string
  versionSha?: string
}

export async function findVersions(
  config: Config,
  releaseFiles: ReleaseFileConfig[]
): Promise<FoundVersionedFile[]> {
  const results: Map<string, FoundVersionedFile> = new Map()
  for (const fileConfig of releaseFiles) {
    const regexes = fileConfig.regex || config.regex || []
    const githubShaRegex =
      fileConfig.githubShaRegex || config.githubShaRegex || []
    console.debug(
      `Finding version changes in release files: ${fileConfig.path} with regex: ${regexes}. Id: ${fileConfig.id}. ShaRegex: ${githubShaRegex}`
    )
    const globber = await glob.create(fileConfig.path)
    const fileResults = await globber.glob()

    for (const filePath of fileResults) {
      for (const fileRegexStr of regexes) {
        const fileRegex = new RegExp(fileRegexStr, 'gm')
        console.debug('Checking file: ', filePath)
        const fileContent = (await fs.readFile(filePath)).toString()
        const matchedArray = fileContent.matchAll(fileRegex)
        for (const matched of matchedArray) {
          if (matched && matched[0] && matched[0].trim().length > 0) {
            const version = matched[0].trim()
            let versionSha: string | undefined = undefined
            let matchedShaRegex: RegExp | undefined = undefined
            if (githubShaRegex.length > 0) {
              console.debug(`Checking for sha in file: ${filePath}`)
              for (const shaRegexStr of githubShaRegex) {
                const shaRegex = new RegExp(shaRegexStr, 'gm')
                const shaMatch = fileContent.match(shaRegex)
                if (shaMatch && shaMatch[0] && shaMatch[0].trim().length > 0) {
                  versionSha = shaMatch[0].trim()
                  matchedShaRegex = shaRegex
                  console.debug(
                    `Found GitHub SHA: ${versionSha} in file: ${filePath}`
                  )
                  break
                }
              }
            } else {
              versionSha = version
            }
            console.debug(
              `Found version: ${version} in a file: ${filePath}. Sha: ${versionSha}. PathId: ${fileConfig.id}`
            )
            const gitPath = filePath
              .replace(process.cwd(), '')
              .replace(/\\/g, '/')
              .replace(/^\//, '')

            const versionedFile: FoundVersionedFile = {
              absolutePath: filePath,
              gitPath: gitPath,
              content: fileContent,
              matchedRegex: fileRegex,
              matchedShaRegex: matchedShaRegex,
              pathId: fileConfig.id,
              version,
              versionSha
            }
            results.set(filePath, versionedFile)
          }
        }
      }
    }
  }
  return Array.from(results.values())
}
