import { GoogleGenAI } from '@google/genai';
import { logger } from '../logger.js';

export interface LLMOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
}

export class LLMProvider {
  private ai?: GoogleGenAI;
  private defaultModel = 'gemini-2.5-flash';

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    } else {
      logger.warn('GEMINI_API_KEY is not set. LLM features will be disabled or fail.');
    }
  }

  /**
   * Prompts the LLM and returns the generated text.
   */
  async prompt(promptText: string, options: LLMOptions = {}): Promise<string> {
    if (!this.ai) {
      throw new Error('LLM Provider is not initialized properly. Check GEMINI_API_KEY.');
    }

    const modelName = options.model || this.defaultModel;

    try {
      logger.info(`Prompting LLM (${modelName})...`);
      
      const config: any = {
        temperature: options.temperature ?? 0.2,
      };

      if (options.systemInstruction) {
         config.systemInstruction = options.systemInstruction;
      }

      const response = await this.ai.models.generateContent({
        model: modelName,
        contents: promptText,
        config
      });

      return response.text || '';
    } catch (error: any) {
      logger.error(`LLM Generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Helper utility to safely extract a code block from LLM markdown responses.
   * Finds the first ``` language block and extracts its contents.
   */
  extractCodeBlock(markdownText: string): string {
    const regex = /```[a-zA-Z]*\n([\s\S]*?)```/;
    const match = markdownText.match(regex);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Fallback: If the LLM just returns raw code without markdown backticks
    if (!markdownText.includes('```')) {
      return markdownText.trim();
    }

    throw new Error('Could not parse a valid code block from the LLM response.');
  }
}

// Export a singleton instance for global use throughout the engine
export const llmProvider = new LLMProvider();
