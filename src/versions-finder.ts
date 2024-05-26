import { ReleaseFileConfig } from './config'
import * as glob from '@actions/glob'
import fs from 'fs/promises'

export interface FoundVersionedFile {
  absolutePath: string
  gitPath: string
  content: string
  matchedRegex: RegExp
}

export interface FoundVersion {
  version: string
  files: FoundVersionedFile[]
}

export async function findVersions(
  releaseFiles: ReleaseFileConfig[]
): Promise<FoundVersion[]> {
  const results = new Map<string, FoundVersion>()
  for (const fileConfig of releaseFiles) {
    console.debug(
      `Finding version changes in release files: ${fileConfig.path} with regex: ${fileConfig.regex}`
    )
    const globber = await glob.create(fileConfig.path)
    const fileResults = await globber.glob()
    const fileRegex = new RegExp(fileConfig.regex, 'g')
    for (const filePath of fileResults) {
      console.debug('Checking file: ', filePath)
      const fileContent = (await fs.readFile(filePath)).toString()
      const matchedArray = fileContent.matchAll(fileRegex)
      for (const matched of matchedArray) {
        if (matched && matched[0] && matched[0].trim().length > 0) {
          const version = matched[0].trim()
          console.debug(`Found version: ${version} in a file: ${filePath}`)
          const existing = results.get(version)
          const gitPath = filePath
            .replace(process.cwd(), '')
            .replace(/\\/g, '/')
            .replace(/^\//, '')

          const versionedFile: FoundVersionedFile = {
            absolutePath: filePath,
            gitPath: gitPath,
            content: fileContent,
            matchedRegex: fileRegex
          }

          if (existing) {
            existing.files.push(versionedFile)
            results.set(version, existing)
          } else {
            results.set(version, { version, files: [versionedFile] })
          }
        }
      }
    }
  }
  return Array.from(results.values())
}
