import * as core from '@actions/core'
import * as github from '@actions/github'
import * as z from 'zod'

import { loadConfigFromYaml } from './config'
import { findChangesInSourceRepo, FoundChanges } from './changes'
import { createPullRequest } from './pull-request'
import { RequestError } from '@octokit/request-error'
import { generateSummaryArtifacts } from './summary-artifacts'
import { parseInputVersions } from './input-versions'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    core.info(
      `Running GitOps PR Automator (https://github.com/abdolence/gitops-pr-automator) ...`
    )

    const configPath: string =
      core.getInput('config-path') ||
      '.github/gitops/gitops-pr-automator.config.yaml'
    core.info(`Loading configuration from ${configPath}`)
    const config = await loadConfigFromYaml(
      configPath,
      core.getInput('config-override')
    )

    const githubToken: string = core.getInput('github-token')
    if (!githubToken) {
      core.setFailed(
        'GitHub token not provided. Please specify the `github-token` input.'
      )
      return
    }

    const defaultOctokit = github.getOctokit(githubToken)

    let repoAccessOctokit = null
    const githubTokenRepoAccess = core.getInput('github-token-read-repos')
    if (githubTokenRepoAccess) {
      repoAccessOctokit = github.getOctokit(githubTokenRepoAccess)
    } else {
      repoAccessOctokit = defaultOctokit
    }

    const inputVersions = core.getInput('versions')
    const overrideVersions = parseInputVersions(inputVersions)

    if (overrideVersions.length > 0) {
      console.log(
        `Override versions: ${overrideVersions.map(v => `${JSON.stringify(v)}`).join(', ')}`
      )
    } else {
      if (inputVersions && inputVersions.trim().length > 0) {
        console.warn(`No valid override versions provided: ${inputVersions}`)
      } else {
        console.log(`No override versions provided: ${inputVersions}`)
      }
    }

    const allRepoChanges: FoundChanges[] = []

    for (const sourceRepo of config.sourceRepos) {
      const repoChanges = await findChangesInSourceRepo(
        config,
        sourceRepo,
        repoAccessOctokit,
        overrideVersions
      )
      if (repoChanges) {
        allRepoChanges.push(repoChanges)
      }
    }

    if (allRepoChanges.length === 0) {
      core.info('No changes found in any of the source repos')
    } else {
      core.info(
        `Found changes in ${allRepoChanges.length} source repos. Creating a new PR or updating an existing one.`
      )
      const pullRequestInfo = await createPullRequest(
        config,
        allRepoChanges,
        defaultOctokit
      )
      core.setOutput(
        'detected-changes',
        allRepoChanges.map(c => c.sourceRepo.repo).join(', ')
      )
      core.setOutput('pull-request-url', pullRequestInfo.html_url)
      core.setOutput('pull-request-number', pullRequestInfo.number.toString())
      core.setOutput('pull-request-id', pullRequestInfo.id.toString())
      await generateSummaryArtifacts(config, allRepoChanges)
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof z.ZodError) {
      console.error(error.errors) // Detailed validation errors
      core.setFailed(error.errors.toString())
    } else if (error instanceof RequestError) {
      console.error(error)
      core.setFailed(error.message)
    } else if (error instanceof Error) {
      console.error(error.message)
      core.setFailed(error.message)
    } else {
      console.error(error)
      core.setFailed('An unexpected error occurred')
    }
  }
}
