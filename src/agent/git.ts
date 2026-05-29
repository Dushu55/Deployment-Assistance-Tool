import { promisify } from 'util';
import { execFile, exec } from 'child_process';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec); // Kept only for simple non-interpolated commands if needed

export class GitAgent {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Checks if there are any uncommitted changes in the workspace.
   */
  async hasChanges(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: this.workspaceRoot });
      return stdout.trim().length > 0;
    } catch (error: any) {
      logger.error(`Failed to check git status: ${error.message}`);
      return false;
    }
  }

  /**
   * Creates and checks out a new branch.
   */
  async createBranch(branchName: string): Promise<boolean> {
    try {
      logger.info(`Creating new branch: ${branchName}`);
      await execFileAsync('git', ['checkout', '-b', branchName], { cwd: this.workspaceRoot });
      return true;
    } catch (error: any) {
      logger.error(`Failed to create branch ${branchName}: ${error.message}`);
      return false;
    }
  }

  /**
   * Stages all changes and commits them with the provided message.
   */
  async commitChanges(message: string): Promise<boolean> {
    try {
      logger.info(`Committing changes: "${message}"`);
      await execFileAsync('git', ['add', '.'], { cwd: this.workspaceRoot });
      
      // Use execFile to bypass the shell entirely. This absolutely prevents Command Injection 
      // via malicious PR titles containing bash substitutions like $(rm -rf /).
      await execFileAsync('git', ['commit', '-m', message], { cwd: this.workspaceRoot });
      
      return true;
    } catch (error: any) {
      logger.error(`Failed to commit changes: ${error.message}`);
      return false;
    }
  }

  /**
   * Pushes the branch to the remote origin.
   */
  async pushBranch(branchName: string): Promise<boolean> {
    try {
      logger.info(`Pushing branch ${branchName} to origin...`);
      await execFileAsync('git', ['push', '-u', 'origin', branchName], { cwd: this.workspaceRoot });
      return true;
    } catch (error: any) {
      logger.error(`Failed to push branch ${branchName}: ${error.message}`);
      return false;
    }
  }

  /**
   * Reverts all uncommitted changes in the workspace.
   */
  async revertChanges(): Promise<void> {
    try {
      logger.info('Reverting uncommitted changes...');
      await execFileAsync('git', ['restore', '.'], { cwd: this.workspaceRoot });
    } catch (error: any) {
      logger.error(`Failed to revert changes: ${error.message}`);
    }
  }
}

