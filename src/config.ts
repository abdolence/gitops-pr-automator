import * as z from 'zod'
import fs from 'fs/promises'
import * as yaml from 'js-yaml'

// Schema for ReleaseFileConfig
const releaseFileConfigSchema = z.object({
  path: z.string(),
  ignore: z.string().optional(),
  regex: z.string()
})

export type ReleaseFileConfig = z.infer<typeof releaseFileConfigSchema>

// Schema for SourceRepoConfig
const sourceRepoConfigSchema = z.object({
  repo: z.string(),
  ref: z.string().optional(),
  releaseFiles: z.array(releaseFileConfigSchema).optional()
})

export type SourceRepoConfig = z.infer<typeof sourceRepoConfigSchema>

const MergeStrategiesSchema = z.union([
  z.literal('squash'),
  z.literal('rebase'),
  z.literal('merge'),
  z.literal(undefined)
])

// TypeScript Type Inference
type MergeStrategies = z.infer<typeof MergeStrategiesSchema>

// Schema for PullRequest
const pullRequestSchema = z.object({
  title: z.string(),
  githubLabels: z.array(z.string()).optional(),
  enableAutoMerge: MergeStrategiesSchema,
  pullRequestComment: z.string().optional()
})

// Main Config schema
export const configSchema = z.object({
  id: z.string(),
  pullRequest: pullRequestSchema,
  sourceRepos: z.array(sourceRepoConfigSchema)
})

// Type for your validated config
export type Config = z.infer<typeof configSchema>

export async function loadConfigFromYaml(configPath: string): Promise<Config> {
  const configContent = await fs.readFile(configPath)
  const config = configSchema.parse(yaml.load(configContent.toString()))
  return config
}
