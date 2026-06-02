import { spawn, ChildProcess } from 'child_process';

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export const activeProcesses = new Set<ChildProcess>();

export async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number = 60000, // 60 seconds default timeout
  cwd: string = process.cwd()
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Not a command-injection sink: spawn() is invoked WITHOUT shell:true and with an explicit
    // args array, so `command`/`args` go straight to execve — no shell metacharacter
    // interpretation. `command` is an internal scanner binary name, never user-controlled input.
    const child = spawn(command, args, { stdio: 'pipe', cwd }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    activeProcesses.add(child);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      activeProcesses.delete(child);
      child.kill('SIGKILL');
      reject(new Error(`Command ${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      activeProcesses.delete(child);
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      activeProcesses.delete(child);
      reject(err);
    });
  });
}
