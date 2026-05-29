import * as fs from 'fs';
import { llmProvider } from '../llm/index.js';
import { logger } from '../logger.js';

export async function refactorToDistroless(dockerfilePath: string): Promise<boolean> {
  if (!fs.existsSync(dockerfilePath)) {
    logger.warn(`Dockerfile not found at ${dockerfilePath}. Cannot refactor.`);
    return false;
  }

  const originalContent = fs.readFileSync(dockerfilePath, 'utf-8');

  const systemInstruction = `
You are a highly skilled DevSecOps Engineer. 
Your only task is to rewrite vulnerable Dockerfiles into secure, multi-stage builds utilizing 'distroless' (e.g., gcr.io/distroless/nodejs20-debian11) or 'scratch' base images for the final runtime stage.
Keep all original environment variables, exposed ports, and commands intact, but ensure the final image contains no build tools, shells, or package managers.
You must return ONLY the raw Dockerfile code inside a \`\`\`dockerfile markdown block. Do not provide any conversational text, preamble, or explanations.
`.trim();

  const promptText = `
Please securely refactor the following Dockerfile to use a distroless base image for the final stage. 

Original Dockerfile:
${originalContent}
`.trim();

  try {
    logger.info(`Sending Dockerfile (${dockerfilePath}) to LLM for Auto-Distroless refactoring...`);
    
    const responseMarkdown = await llmProvider.prompt(promptText, {
      systemInstruction,
      temperature: 0.1 // Keep it very deterministic
    });

    const refactoredCode = llmProvider.extractCodeBlock(responseMarkdown);

    if (!refactoredCode) {
      throw new Error('LLM returned an empty code block.');
    }

    // SECURITY PATCH: Validate that the LLM hasn't introduced prompt-injected malicious commands
    const forbiddenPatterns = [
        /RUN\s+(?:curl|wget|nc|netcat|nmap|telnet|ssh|bash\s+-i|sh\s+-i)/i,
        /EXPOSE\s+22\b/i
    ];

    for (const pattern of forbiddenPatterns) {
        if (pattern.test(refactoredCode)) {
            throw new Error(`LLM generated insecure content matching forbidden pattern: ${pattern}. Refactor aborted.`);
        }
    }

    // Backup original just in case, or we rely on the Git rollback loop from the Orchestrator
    // For now, we will just overwrite it, as our Orchestrator's rollback loop will save us.
    fs.writeFileSync(dockerfilePath, refactoredCode, 'utf-8');
    
    logger.info(`Successfully rewrote ${dockerfilePath} using a distroless architecture.`);
    return true;

  } catch (error: any) {
    logger.error(`Failed to auto-refactor Dockerfile: ${error.message}`);
    return false;
  }
}
