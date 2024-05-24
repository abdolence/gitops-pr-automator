import * as core from '@actions/core'
import * as github from '@actions/github'
import * as z from 'zod'

import { loadConfigFromYaml } from './config'
import { findChangesInSourceRepo, FoundChanges } from './changes'
import { createPullRequest } from './pull-request'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    core.info(`Running GitOps PR Automator ...`)

    const configPath: string = core.getInput("config-path") || ".github/gitops/gitops-pr-automator.config.yaml";
    core.info(`Loading configuration from ${configPath}`);
    const config = await loadConfigFromYaml(configPath);

    const githubToken: string = core.getInput('github-token');
    if(!githubToken) {
      core.setFailed('GitHub token not provided. Please specify the `github-token` input.');
      return;
    }

    const octokit = github.getOctokit(githubToken);

    const allRepoChanges: FoundChanges[] = [];

    for (const sourceRepo of config.sourceRepos) {
      const repoChanges = await findChangesInSourceRepo(sourceRepo, octokit);
      if(repoChanges) {
        allRepoChanges.push(repoChanges);
      }
    }

    if(allRepoChanges.length === 0) {
      core.info('No changes found in any of the source repos');
    }
    else {
      core.info(`Found changes in ${allRepoChanges.length} source repos. Creating a new PR`);
      await createPullRequest(config, allRepoChanges, octokit);
    }

    // Log the current timestamp
    core.debug(new Date().toTimeString())

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof z.ZodError) {
      console.error(error.errors); // Detailed validation errors
      core.setFailed(error.errors.toString());
    }
    else if (error instanceof Error) {
      console.error(error.message);
      core.setFailed(error.message);
    }
    else {
      console.error(error);
      core.setFailed('An unexpected error occurred');
    }
  }
}

