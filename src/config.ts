import * as z from 'zod'
import fs from 'fs/promises'
import * as yaml from 'js-yaml'
import { merge } from 'ts-deepmerge'

// Schema for ReleaseFileConfig
const releaseFileConfigSchema = z.object({
  path: z.string(),
  ignore: z.string().optional(),
  regex: z.array(z.string()).optional()
})

export type ReleaseFileConfig = z.infer<typeof releaseFileConfigSchema>

// Schema for SourceRepoConfig
const sourceRepoConfigSchema = z.object({
  repo: z.string(),
  ref: z.string().optional(),
  releaseFiles: z.array(releaseFileConfigSchema).optional()
})

export type SourceRepoConfig = z.infer<typeof sourceRepoConfigSchema>

const mergeStrategiesSchema = z.union([
  z.literal('squash'),
  z.literal('rebase'),
  z.literal('merge')
])

const pullRequestCommitHistorySchema = z.object({
  disable: z.boolean().optional(),
  onlyMergeCommits: z.boolean().optional()
})

// TypeScript Type Inference
export type MergeStrategies = z.infer<typeof mergeStrategiesSchema>

// Schema for PullRequest
const pullRequestSchema = z.object({
  title: z.string(),
  githubLabels: z.array(z.string()).optional(),
  enableAutoMerge: mergeStrategiesSchema.optional(),
  pullRequestComment: z.string().optional(),
  commitHistory: pullRequestCommitHistorySchema.optional(),
  cleanupExistingAutomatorBranches: z.boolean().optional(),
  alwaysCreateNew: z.boolean().optional(),
  leaveOpenOnlyNumberOfPRs: z.number().optional(),
  includeGitHubOwnerInDescription: z.boolean().optional()
})

const versioningSchemeSchema = z.union([
  z.literal('commit-sha-only'),
  z.literal('commit-tags-or-sha'),
  z.literal('commit-tags-only')
])

const versioningSchema = z.object({
  scheme: versioningSchemeSchema,
  resolveTagsPattern: z.string().optional()
})

const artifactConfigSchema = z.object({
  summaryMarkdownAs: z.string().optional(),
  summaryJsonAs: z.string().optional()
})

// Main Config schema
export const configSchema = z.object({
  id: z.string(),
  pullRequest: pullRequestSchema,
  versioning: versioningSchema.optional(),
  sourceRepos: z.array(sourceRepoConfigSchema),
  regex: z.array(z.string()).optional(),
  artifacts: artifactConfigSchema.optional()
})

// Type for your validated config
export type Config = z.infer<typeof configSchema>

export async function loadConfigFromYaml(
  configPath: string,
  configOverride?: string
): Promise<Config> {
  const fileConfigContent = await fs.readFile(configPath)
  const fileConfigYaml: any = yaml.load(fileConfigContent.toString())
  let config: any = fileConfigYaml
  if (configOverride) {
    const overrideConfig: any = yaml.load(configOverride)
    config = merge(fileConfigYaml, overrideConfig)
  }
  return configSchema.parse(config)
}
