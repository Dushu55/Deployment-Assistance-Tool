import { runCommand } from '../runner.js';
import { ScannerResult, Scanner } from '../types.js';

export async function runCoverAgent(sourceFilePath?: string, testFilePath?: string, testCommand?: string, llmModel?: string): Promise<ScannerResult> {
  const startTime = Date.now();

  // Cover-Agent needs an LLM to generate tests. It routes models via litellm, which reads the
  // provider's key from the env — so accept GEMINI_API_KEY (the key operators set in DAT settings)
  // alongside OpenAI/Anthropic. With Gemini we pass an explicit litellm model id below.
  const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !hasGemini) {
    return {
      scannerName: 'Qodo Cover-Agent',
      success: true, // Graceful skip
      durationMs: Date.now() - startTime,
      issues: [{ id: 'NO-API-KEY', severity: 'INFO', message: 'Skipping Cover-Agent: no LLM API key (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY) found.', source: 'Cover-Agent' }]
    };
  }

  // litellm model id for the Gemini key path (e.g. gemini/gemini-2.5-flash). Only set when Gemini
  // is the only key present, so an explicit OpenAI/Anthropic key keeps cover-agent's own default.
  const geminiModel = hasGemini && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY
    ? `gemini/${llmModel || 'gemini-2.5-flash'}`
    : undefined;

  try {
    // If specific files are provided, run a real cover-agent test generation loop
    const args: string[] = [];
    if (sourceFilePath && testFilePath && testCommand) {
      args.push(
        '--source-file-path', sourceFilePath,
        '--test-file-path', testFilePath,
        '--test-command', testCommand,
        '--max-iterations', '3'
      );
      if (geminiModel) args.push('--model', geminiModel);
    } else {
      // Fall back to showing help to verify installation
      args.push('--help');
    }

    const result = await runCommand('cover-agent', args, 120000); 
    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0) {
       return {
          scannerName: 'Qodo Cover-Agent', success: false, durationMs, issues: [],
          error: `Cover-Agent failed: ${result.stderr.trim() || result.stdout.trim()}`
       };
    }

    return { 
        scannerName: 'Qodo Cover-Agent', 
        success: true, 
        durationMs, 
        issues: [{ id: 'TESTS-GENERATED', severity: 'INFO', message: 'Cover-Agent executed successfully. Automated tests generated.', source: 'Cover-Agent' }] 
    };
  } catch (err) {
     return { scannerName: 'Qodo Cover-Agent', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const coverAgentScanner: Scanner = {
  name: 'Qodo Cover-Agent',
  module: 'testing',
  supportedLanguages: 'all',
  requiredBinaries: ['cover-agent'],
  async run(ctx) {
    const config = ctx.config.scanners.coverAgent;
    return runCoverAgent(config?.sourceFilePath, config?.testFilePath, config?.testCommand, ctx.config.llm?.model);
  }
};
