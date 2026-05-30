import { GoogleGenAI } from '@google/genai';
import { logger } from '../logger.js';

export interface LLMOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
}

export interface LLMBackendConfig {
  provider?: 'vertex' | 'apikey';
  project?: string;
  location?: string;
  model?: string;
}

export type ResolvedBackend =
  | { mode: 'apikey'; apiKey: string; model?: string }
  | { mode: 'vertex'; project: string; location: string; model?: string }
  | { mode: 'none' };

/**
 * Decide which Gemini backend to use, from explicit config then environment.
 * Priority: explicit `cfg.provider` → GEMINI_API_KEY (apikey) → GCP project (vertex) → none.
 * NOTE: the consumer "Google AI Pro" subscription is NOT a programmatic backend; only an AI Studio
 * API key (GEMINI_API_KEY) or Vertex AI on a GCP project can authenticate API calls.
 */
export function resolveLLMBackend(cfg: LLMBackendConfig = {}): ResolvedBackend {
  const apiKey = process.env.GEMINI_API_KEY;
  const project = cfg.project || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const location = cfg.location || process.env.GCP_REGION || 'us-central1';

  if (cfg.provider === 'apikey') {
    return apiKey ? { mode: 'apikey', apiKey, model: cfg.model } : { mode: 'none' };
  }
  if (cfg.provider === 'vertex') {
    return project ? { mode: 'vertex', project, location, model: cfg.model } : { mode: 'none' };
  }
  // Auto: prefer an explicit API key (simplest/cheapest), else Vertex if a project is configured.
  if (apiKey) return { mode: 'apikey', apiKey, model: cfg.model };
  if (project) return { mode: 'vertex', project, location, model: cfg.model };
  return { mode: 'none' };
}

export class LLMProvider {
  private ai?: GoogleGenAI;
  private backend: ResolvedBackend = { mode: 'none' };
  private configured = false;
  private defaultModel = 'gemini-2.5-flash';

  /** Configure the backend explicitly (called once by the orchestrator after loadConfig). */
  configure(cfg: LLMBackendConfig = {}): void {
    this.backend = resolveLLMBackend(cfg);
    this.configured = true;
    this.ai = undefined; // rebuild lazily on next use
    if (cfg.model) this.defaultModel = cfg.model;
  }

  /** True when a usable backend (apikey or vertex) is configured/derivable. */
  isAvailable(): boolean {
    if (!this.configured) this.backend = resolveLLMBackend();
    return this.backend.mode !== 'none';
  }

  private getClient(): GoogleGenAI {
    if (this.ai) return this.ai;
    if (!this.configured) this.backend = resolveLLMBackend();

    if (this.backend.mode === 'apikey') {
      this.ai = new GoogleGenAI({ apiKey: this.backend.apiKey });
      logger.info('LLM backend: Google AI Studio (API key).');
    } else if (this.backend.mode === 'vertex') {
      // Vertex uses Application Default Credentials (gcloud auth application-default login).
      this.ai = new GoogleGenAI({ vertexai: true, project: this.backend.project, location: this.backend.location });
      logger.info(`LLM backend: Vertex AI (project=${this.backend.project}, location=${this.backend.location}).`);
    } else {
      throw new Error('No LLM backend configured. Set GEMINI_API_KEY (AI Studio) or a GCP project for Vertex AI.');
    }
    if (this.backend.model) this.defaultModel = this.backend.model;
    return this.ai;
  }

  /** Prompts the LLM and returns the generated text. */
  async prompt(promptText: string, options: LLMOptions = {}): Promise<string> {
    const client = this.getClient();
    const modelName = options.model || this.defaultModel;
    try {
      logger.info(`Prompting LLM (${modelName})...`);
      const config: any = { temperature: options.temperature ?? 0.2 };
      if (options.systemInstruction) config.systemInstruction = options.systemInstruction;
      const response = await client.models.generateContent({ model: modelName, contents: promptText, config });
      return response.text || '';
    } catch (error: any) {
      logger.error(`LLM Generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Prompts and parses a JSON response. Returns null on any failure (never throws into the
   * pipeline) so an unparseable/garbage LLM response can't break a scan.
   */
  async promptJSON<T = any>(promptText: string, options: LLMOptions = {}): Promise<T | null> {
    try {
      const raw = await this.prompt(promptText, options);
      return parseJsonLoose<T>(raw);
    } catch (error: any) {
      logger.warn(`LLM JSON prompt failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Helper utility to safely extract a code block from LLM markdown responses.
   * Finds the first ``` language block and extracts its contents.
   */
  extractCodeBlock(markdownText: string): string {
    const regex = /```[a-zA-Z]*\n([\s\S]*?)```/;
    const match = markdownText.match(regex);
    if (match && match[1]) return match[1].trim();
    if (!markdownText.includes('```')) return markdownText.trim();
    throw new Error('Could not parse a valid code block from the LLM response.');
  }
}

/** Best-effort JSON extraction: handles raw JSON, ```json fences, and surrounding prose. */
export function parseJsonLoose<T = any>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  // Narrow to the outermost JSON array/object if there's surrounding prose.
  const start = Math.min(
    ...[candidate.indexOf('['), candidate.indexOf('{')].filter(i => i >= 0).concat([Infinity])
  );
  const endArr = candidate.lastIndexOf(']');
  const endObj = candidate.lastIndexOf('}');
  const end = Math.max(endArr, endObj);
  const slice = start !== Infinity && end > start ? candidate.slice(start, end + 1) : candidate;
  try {
    return JSON.parse(slice) as T;
  } catch {
    return null;
  }
}

// Export a singleton instance for global use throughout the engine
export const llmProvider = new LLMProvider();
