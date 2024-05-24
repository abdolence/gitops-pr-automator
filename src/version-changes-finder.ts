import { ReleaseFileConfig } from './config'
import * as glob from '@actions/glob'
import fs from 'fs/promises'

export async function findVersionChanges(releaseFiles: ReleaseFileConfig[]): Promise<Set<string>> {
  const results = new Set<string>();
  for (const fileConfig of releaseFiles) {
    console.debug(`Finding version changes in release files: ${fileConfig.path} with regex: ${fileConfig.regex}`);
    const globber = await glob.create(fileConfig.path);
    const fileResults = await globber.glob();
    const fileRegex = new RegExp(fileConfig.regex);
    for (const filePath of fileResults) {
      console.debug("Checking file: ", filePath);
      const fileContent = await fs.readFile(filePath);
      const matched = fileContent.toString().match(fileRegex);
      if(matched && matched[0] && matched[0].trim().length > 0) {
        results.add(matched[0].trim());
      }
    }
  }
  return results;
}
