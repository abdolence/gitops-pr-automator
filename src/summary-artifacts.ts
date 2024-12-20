import { Config } from './config'
import { FoundChanges } from './changes'
import fs from 'fs/promises'
import { resolveAllPrRefs } from './pull-request'
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
    const summaryMarkdownPathDir = summaryMarkdownPath
      .split('/')
      .slice(0, -1)
      .join('/')
    await fs.mkdir(summaryMarkdownPathDir, { recursive: true })
    await fs.writeFile(summaryMarkdownPath, summaryMarkdownContent)
  }
  if (config.artifacts?.summaryJsonAs) {
    const summaryJsonPath = config.artifacts.summaryJsonAs
    const summaryJsonContent = JSON.stringify(allRepoChanges, null, 2)
    core.info(`Writing summary json to ${summaryJsonPath}`)
    const summaryJsonPathDir = summaryJsonPath.split('/').slice(0, -1).join('/')
    await fs.mkdir(summaryJsonPathDir, { recursive: true })
    await fs.writeFile(summaryJsonPath, summaryJsonContent)
  }
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
      const shortMessage = resolveAllPrRefs(
        commit.commit.message.split('\n')[0],
        repoChanges
      )
      content += `- [\`${commit.sha.slice(0, 8)}\`](${commit.html_url}) ${shortMessage} by @${commit.author.login}\n`
    }
    content += '\n'
  }
  return content
}
