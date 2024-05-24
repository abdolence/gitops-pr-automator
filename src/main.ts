import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as github from '@actions/github';
import * as yaml from 'js-yaml';
import * as fs from 'fs/promises';

import { Config } from './config';

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    core.info(`Running GitOps PR Automator ...`)

    let g = await glob.create("**/*.yaml");
    let gl = await g.glob();
    console.log(gl);

    const config = yaml.load(await fs.readFile(".github/gitops/gitops-pr-automator.config.yaml").toString()) as Config;
    console.log(config);

    const regex = new RegExp("(?<=(tag: ))[a-f0-9]{40}(?=(.*))");
    const matched = "test tag: 1234567890123456789012345678901234567890 test".match(regex);
    console.log(matched);

    const githubToken: string = core.getInput('github-token');
    if(!githubToken) {
      core.setFailed('GitHub token not provided. Please specify the `github-token` input.');
      return;
    }

    // Log the current timestamp
    core.debug(new Date().toTimeString())

    const octokit = github.getOctokit(githubToken);
    const { data: refData } = await octokit.rest.git.getRef({
      owner: "abdolence",
      repo: "gitops-pr-automator",
      ref: 'heads/master'
    });

    console.log(refData);

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
