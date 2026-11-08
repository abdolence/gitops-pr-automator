import { Config } from './config.js'
import { FoundChanges } from './changes.js'
import fs from 'fs/promises'
import path from 'path'
import { formatCommitLine } from './pull-request.js'
import * as core from '@actions/core'

export async function generateSummaryArtifacts(
  config: Config,
  allRepoChanges: FoundChanges[]
): Promise<void> {
  if (config.artifacts?.summaryMarkdownAs) {
    const summaryMarkdownPath = config.artifacts.summaryMarkdownAs
    const summaryMarkdownContent = generateSummaryMarkdownContent(
      config,
      allRepoChanges
    )
    core.info(`Writing summary markdown to ${summaryMarkdownPath}`)
    await writeFileCreatingDirectories(
      summaryMarkdownPath,
      summaryMarkdownContent
    )
  }
  if (config.artifacts?.summaryJsonAs) {
    const summaryJsonPath = config.artifacts.summaryJsonAs
    const summaryJsonContent = JSON.stringify(allRepoChanges, null, 2)
    core.info(`Writing summary json to ${summaryJsonPath}`)
    await writeFileCreatingDirectories(summaryJsonPath, summaryJsonContent)
  }
}

async function writeFileCreatingDirectories(
  filePath: string,
  content: string
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
}

function generateSummaryMarkdownContent(
  config: Config,
  allRepoChanges: FoundChanges[]
): string {
  let content = `# Summary of Changes\n\n`
  for (const repoChanges of allRepoChanges) {
    let repoName = repoChanges.sourceRepo.repo.split('/')[1]
    if (config.pullRequest.includeGitHubOwnerInDescription) {
      repoName = repoChanges.sourceRepo.repo
    }
    content += `## ${repoName}\n\n`
    content += `## Version Changes\n\n`
    content += `${repoChanges.repoVersionsToUpdate.map(ver => `\`${ver.existingVersion}\``).join(', ')} -> ${repoChanges.repoVersionsToUpdate.map(ver => `\`${ver.newVersion}\``).join(', ')}\n\n`
    content += `### Commits\n\n`
    for (const commit of repoChanges.commits) {
      content += formatCommitLine(commit, repoChanges)
    }
    content += '\n'
  }
  return content
}
