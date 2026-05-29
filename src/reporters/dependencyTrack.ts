import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';

export async function pushToDependencyTrack(
  sbomPath: string,
  dtrackUrl: string,
  dtrackApiKey: string,
  projectName: string,
  projectVersion: string = '1.0'
): Promise<boolean> {
  const fullPath = path.resolve(process.cwd(), sbomPath);
  
  if (!fs.existsSync(fullPath)) {
    logger.warn(`Cannot push to Dependency-Track: SBOM file not found at ${fullPath}`);
    return false;
  }

  try {
    const sbomContent = fs.readFileSync(fullPath, 'base64');

    const payload = {
      projectName,
      projectVersion,
      autoCreate: true,
      bom: sbomContent
    };

    const endpoint = `${dtrackUrl.replace(/\/$/, '')}/api/v1/bom`;

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'X-Api-Key': dtrackApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error(`Dependency-Track API error (${response.status}): ${text}`);
      return false;
    }

    return true;
  } catch (error: any) {
    logger.error(`Failed to push SBOM to Dependency-Track: ${error.message}`);
    return false;
  }
}
