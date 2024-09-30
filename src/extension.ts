import * as vscode from 'vscode';
import { spawn } from 'child_process';
import axios from 'axios';
import * as path from 'path';
import {
    englishShortInstructions,
    englishLongInstructions,
    russianShortInstructions,
    russianLongInstructions,
    customInstructions
} from './commitInstructions';
import { analyzeFileChanges } from './gitBlameAnalyzer';
import { CustomEndpointService } from './customEndpoint';
import { Logger } from './logger';
import { ConfigService } from './configService';

// Constants
const EXTENSION_NAME = 'GeminiCommit';
const COMMAND_ID = 'geminicommit.generateCommitMessage';
const VIEW_ID = 'geminiCommitView';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_DIFF_LENGTH = 10000;
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const ERROR_MESSAGES = {
    NO_GIT_EXTENSION: 'Git extension not found. Please make sure it is installed and enabled.',
    NO_REPOSITORIES: 'No Git repositories found in the current workspace.',
    NO_CHANGES: 'No changes detected in the repository.',
    NO_REPO_SELECTED: 'No repository selected. Operation cancelled.',
    EMPTY_COMMIT_MESSAGE: 'Generated commit message is empty.',
    API_KEY_NOT_SET: 'API key is not set. Please set it in the extension settings.'
};

// Types
type GitExtension = { getAPI(version: number): GitAPI };
type GitAPI = { repositories: Repository[] };
type Repository = { rootUri: vscode.Uri; inputBox: { value: string } };
type ErrorWithResponse = Error & { response?: { status: number; data: any } };

// Git Service
class GitService {
    static getDiff = async (repoPath: string): Promise<string> => {
        Logger.log(`Getting diff for repository: ${repoPath}`);
        const diff = await this.executeGitCommand(['diff'], repoPath);
        if (!diff.trim()) throw new Error(ERROR_MESSAGES.NO_CHANGES);
        return diff;
    };

    private static executeGitCommand = (args: string[], cwd: string): Promise<string> =>
        new Promise((resolve, reject) => {
            const childProcess = spawn('git', args, { cwd });
            let stdout = '';
            let stderr = '';

            childProcess.stdout.on('data', (data) => { stdout += data; });
            childProcess.stderr.on('data', (data) => { stderr += data; });
            childProcess.on('close', (code) => {
                code !== 0
                    ? reject(new Error(`Git ${args.join(' ')} failed with code ${code}: ${stderr}`))
                    : resolve(stdout);
            });
        });

    static getRepositories = async (): Promise<Repository[]> => {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) throw new Error(ERROR_MESSAGES.NO_GIT_EXTENSION);

        const git = gitExtension.exports.getAPI(1);
        const repos = git.repositories;
        if (repos.length === 0) throw new Error(ERROR_MESSAGES.NO_REPOSITORIES);

        return repos;
    };

    static selectRepository = async (repos: Repository[]): Promise<Repository> => {
        if (repos.length === 1) return repos[0];

        const repoOptions = repos.map(repo => ({
            label: repo.rootUri.fsPath,
            repository: repo
        }));

        const selected = await vscode.window.showQuickPick(repoOptions, {
            placeHolder: 'Select the repository to generate commit message'
        });

        if (!selected) throw new Error(ERROR_MESSAGES.NO_REPO_SELECTED);
        return selected.repository;
    };

    static getChangedFiles = async (repoPath: string): Promise<string[]> => {
        const output = await this.executeGitCommand(['status', '--porcelain'], repoPath);
        return output.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => line.substring(3).trim());
    };
}

// Prompt Service
class PromptService {
    static generatePrompt = (diff: string, blameAnalysis: string, language: string, messageLength: string): string => {
        const instructions = this.getInstructions(language, messageLength);
        return `${instructions}
      
      Git diff to analyze:
      ${diff}
      
      Git blame analysis:
      ${blameAnalysis}
      
      Please provide ONLY the commit message, without any additional text or explanations.`;
    };

    private static getInstructions = (language: string, messageLength: string): string => {
        type InstructionKey = 'english-short' | 'english-long' | 'russian-short' | 'russian-long' | 'custom';
        const key = `${language}-${messageLength}` as InstructionKey;

        const instructionsMap: Record<InstructionKey, string> = {
            'english-short': englishShortInstructions,
            'english-long': englishLongInstructions,
            'russian-short': russianShortInstructions,
            'russian-long': russianLongInstructions,
            'custom': customInstructions.replace('{customInstructions}', ConfigService.getCustomInstructions())
        };

        return instructionsMap[key] ?? englishShortInstructions;
    };
}

// AI Service
class AIService {
    static generateCommitMessage = async (
        diff: string,
        blameAnalysis: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<{ message: string, model: string }> => {
        const language = ConfigService.getCommitLanguage();
        const messageLength = ConfigService.getCommitMessageLength();
        const truncatedDiff = this.truncateDiff(diff);
        const prompt = PromptService.generatePrompt(truncatedDiff, blameAnalysis, language, messageLength);

        progress.report({ message: "Generating commit message...", increment: 50 });

        if (ConfigService.useCustomEndpoint()) {
            return CustomEndpointService.generateCommitMessage(prompt, progress);
        } else {
            return this.generateWithGemini(prompt, progress);
        }
    };

    private static truncateDiff = (diff: string): string => {
        if (diff.length > MAX_DIFF_LENGTH) {
            Logger.log(`Original diff length: ${diff.length}. Truncating to ${MAX_DIFF_LENGTH} characters.`);
            return `${diff.substring(0, MAX_DIFF_LENGTH)}\n...(truncated)`;
        }
        Logger.log(`Diff length: ${diff.length} characters`);
        return diff;
    };

    private static generateWithGemini = async (
        prompt: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        attempt: number = 1
    ): Promise<{ message: string, model: string }> => {
        const apiKey = await ConfigService.getApiKey();
        const model = ConfigService.getGeminiModel();
        const GEMINI_API_URL = `${GEMINI_API_BASE_URL}/${model}:generateContent`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            },
        };
        const headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        };

        try {
            Logger.log(`Attempt ${attempt}: Sending request to Gemini API`);
            progress.report({ message: `Attempt ${attempt}: Generating commit message...`, increment: 10 });
            const { data } = await axios.post(GEMINI_API_URL, payload, { headers });
            Logger.log('Gemini API response received successfully');
            progress.report({ message: "Commit message generated successfully", increment: 100 });
            const commitMessage = this.cleanCommitMessage(data.candidates[0].content.parts[0].text);
            if (!commitMessage.trim()) throw new Error(ERROR_MESSAGES.EMPTY_COMMIT_MESSAGE);
            return { message: commitMessage, model };
        } catch (error) {
            Logger.error(`Attempt ${attempt} failed:`, error as Error);
            const { errorMessage, shouldRetry } = this.handleApiError(error as ErrorWithResponse);

            if (shouldRetry && attempt < MAX_RETRIES) {
                const delayMs = this.calculateRetryDelay(attempt);
                Logger.log(`Retrying in ${delayMs / 1000} seconds...`);
                progress.report({ message: `Retrying in ${delayMs / 1000} seconds...`, increment: 0 });
                await this.delay(delayMs);
                return this.generateWithGemini(prompt, progress, attempt + 1);
            }

            throw new Error(`Failed to generate commit message: ${errorMessage}`);
        }
    };

    private static calculateRetryDelay = (attempt: number): number =>
        Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1), 10000);

    private static delay = (ms: number): Promise<void> =>
        new Promise(resolve => setTimeout(resolve, ms));

    private static handleApiError = (error: ErrorWithResponse): { errorMessage: string, shouldRetry: boolean } => {
        if (error.response) {
            const { status, data } = error.response;
            const responseData = JSON.stringify(data);

            if (status === 403) {
                return {
                    errorMessage: `Access forbidden. Please check your API key. (Status: ${status})`,
                    shouldRetry: false
                };
            } else if (status === 429) {
                return {
                    errorMessage: `Rate limit exceeded. Please try again later. (Status: ${status})`,
                    shouldRetry: true
                };
            }

            return {
                errorMessage: `${error.message} (Status: ${status}). Response data: ${responseData}`,
                shouldRetry: status >= 500
            };
        }
        return { errorMessage: error.message, shouldRetry: true };
    };

    private static cleanCommitMessage = (message: string): string =>
        message
            .replace(/^["']|["']$/g, '')
            .replace(/^(Here'?s? (is )?(a )?)?commit message:?\s*/i, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
}

// Tree Data Provider
class GeminiCommitTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem = (element: vscode.TreeItem): vscode.TreeItem => element;

    getChildren = (element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> => {
        if (element) return Promise.resolve([]);
        const generateButton = new vscode.TreeItem("Generate Commit Message");
        generateButton.command = {
            command: COMMAND_ID,
            title: `${EXTENSION_NAME}: Generate Message`
        };
        return Promise.resolve([generateButton]);
    };
}

// Main Extension Functions
const generateAndSetCommitMessage = async () => {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Generating Commit Message",
        cancellable: false
    }, async (progress) => {
        try {
            const repos = await GitService.getRepositories();
            const selectedRepo = await GitService.selectRepository(repos);

            progress.report({ message: "Fetching Git diff...", increment: 0 });
            const diff = await GitService.getDiff(selectedRepo.rootUri.fsPath);
            Logger.log(`Git diff fetched successfully. Length: ${diff.length} characters`);

            progress.report({ message: "Analyzing changes...", increment: 25 });
            const changedFiles = await GitService.getChangedFiles(selectedRepo.rootUri.fsPath);
            let blameAnalysis = '';
            for (const file of changedFiles) {
                const filePath = vscode.Uri.file(path.join(selectedRepo.rootUri.fsPath, file));
                try {
                    const fileBlameAnalysis = await analyzeFileChanges(filePath.fsPath);
                    blameAnalysis += `File: ${file}\n${fileBlameAnalysis}\n\n`;
                } catch (error) {
                    Logger.error(`Error analyzing file ${file}:`, error as Error);
                    blameAnalysis += `File: ${file}\nUnable to analyze: ${(error as Error).message}\n\n`;
                }
            }

            progress.report({ message: "Generating commit message...", increment: 50 });
            const { message: commitMessage, model } = await AIService.generateCommitMessage(diff, blameAnalysis, progress);
            Logger.log('Commit message generated successfully');

            let finalMessage = commitMessage;

            if (ConfigService.shouldPromptForRefs()) {
                const refs = await vscode.window.showInputBox({
                    prompt: "Enter references (e.g., issue numbers) to be added below the commit message",
                    placeHolder: "e.g., #123, JIRA-456"
                });

                if (refs) {
                    finalMessage += `\n\n${refs}`;
                }
            }

            progress.report({ message: "Setting commit message...", increment: 75 });
            selectedRepo.inputBox.value = finalMessage;
            Logger.log('Commit message set successfully');

            progress.report({ message: "Done!", increment: 100 });
            vscode.window.showInformationMessage(`Commit message set in selected Git repository. Generated using ${model} model.`);
        } catch (error) {
            Logger.error('Error in command execution:', error as Error);
            vscode.window.showErrorMessage(`Failed to generate commit message: ${(error as Error).message}`);
        }
    });
};

// Extension Activation and Deactivation
export const activate = (context: vscode.ExtensionContext): void => {
    Logger.log(`${EXTENSION_NAME} extension is now active!`);

    ConfigService.initialize(context);

    const generateCommitMessageCommand = vscode.commands.registerCommand(COMMAND_ID, generateAndSetCommitMessage);

    const treeDataProvider = new GeminiCommitTreeDataProvider();
    const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider });

    context.subscriptions.push(generateCommitMessageCommand, treeView);

    // Register command to set API key
    const setApiKeyCommand = vscode.commands.registerCommand('geminicommit.setApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Google API Key',
            ignoreFocusOut: true,
            password: true
        });
        if (key) {
            await ConfigService.setApiKey(key);
            vscode.window.showInformationMessage('API key has been set successfully.');
        }
    });
    context.subscriptions.push(setApiKeyCommand);

    // Register command to set custom API key
    const setCustomApiKeyCommand = vscode.commands.registerCommand('geminicommit.setCustomApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Custom API Key',
            ignoreFocusOut: true,
            password: true
        });
        if (key) {
            await ConfigService.setCustomApiKey(key);
            vscode.window.showInformationMessage('Custom API key has been set successfully.');
        }
    });
    context.subscriptions.push(setCustomApiKeyCommand);
};

export const deactivate = (): void => {
    Logger.log(`${EXTENSION_NAME} extension is now deactivated.`);
    ConfigService.clearCache();
};