import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { CustomEndpointService } from './customEndpointService';
import { PromptService } from './promptService';
import { GitService } from './gitService';
import { analyzeFileChanges } from './gitBlameAnalyzer';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_DIFF_LENGTH = 10000;
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
}

interface ApiErrorResponse {
    status: number;
    data: unknown;
}

type ErrorWithResponse = Error & {
    response?: ApiErrorResponse;
};

interface ApiHeaders {
    contentType: string;
    xGoogApiKey: string;
}

export class AIService {
    static async generateCommitMessage(
        diff: string,
        blameAnalysis: string,
        progress: ProgressReporter
    ): Promise<CommitMessage> {
        const truncatedDiff = this.truncateDiff(diff);
        const prompt = PromptService.generatePrompt(truncatedDiff, blameAnalysis);

        progress.report({ message: "Generating commit message...", increment: 50 });

        try {
            if (ConfigService.useCustomEndpoint()) {
                return await CustomEndpointService.generateCommitMessage(prompt, progress);
            } else {
                return await this.generateWithGemini(prompt, progress);
            }
        } catch (error) {
            void Logger.error('Failed to generate commit message:', error as Error);
            throw new Error(`Failed to generate commit message: ${(error as Error).message}`);
        }
    }

    private static truncateDiff(diff: string): string {
        if (diff.length > MAX_DIFF_LENGTH) {
            void Logger.log(`Original diff length: ${diff.length}. Truncating to ${MAX_DIFF_LENGTH} characters.`);
            return `${diff.substring(0, MAX_DIFF_LENGTH)}\n...(truncated)`;
        }
        void Logger.log(`Diff length: ${diff.length} characters`);
        return diff;
    }

    private static async generateWithGemini(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        const apiKey = await ConfigService.getApiKey();
        const model = ConfigService.getGeminiModel();
        const GEMINI_API_URL = `${GEMINI_API_BASE_URL}/${model}:generateContent`;

        const headers: ApiHeaders = {
            contentType: 'application/json',
            xGoogApiKey: apiKey
        };

        const requestHeaders = {
            contentType: headers.contentType,
            xGoogApiKey: headers.xGoogApiKey
        };

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            },
        };

        try {
            void Logger.log(`Attempt ${attempt}: Sending request to Gemini API`);
            progress.report({ message: `Attempt ${attempt}: Generating commit message...`, increment: 10 });

            const response = await axios.post<GeminiResponse>(GEMINI_API_URL, payload, {
                headers: {
                    'content-type': requestHeaders.contentType,
                    'x-goog-api-key': requestHeaders.xGoogApiKey
                }
            });

            void Logger.log('Gemini API response received successfully');
            progress.report({ message: "Commit message generated successfully", increment: 100 });

            const responseData = response.data;
            if (!responseData.candidates?.[0]?.content?.parts?.[0]?.text) {
                throw new Error("Invalid response format from Gemini API");
            }

            const commitMessage = this.cleanCommitMessage(responseData.candidates[0].content.parts[0].text);
            if (!commitMessage.trim()) {
                throw new Error("Generated commit message is empty.");
            }

            return { message: commitMessage, model };
        } catch (error) {
            void Logger.error(`Attempt ${attempt} failed:`, error as Error);
            const { errorMessage, shouldRetry } = this.handleApiError(error as ErrorWithResponse);

            if (shouldRetry && attempt < MAX_RETRIES) {
                const delayMs = this.calculateRetryDelay(attempt);
                void Logger.log(`Retrying in ${delayMs / 1000} seconds...`);
                progress.report({ message: `Retrying in ${delayMs / 1000} seconds...`, increment: 0 });
                await this.delay(delayMs);
                return this.generateWithGemini(prompt, progress, attempt + 1);
            }

            throw new Error(`Failed to generate commit message: ${errorMessage}`);
        }
    }

    private static calculateRetryDelay(attempt: number): number {
        return Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1), 10000);
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private static handleApiError(error: ErrorWithResponse): { errorMessage: string; shouldRetry: boolean } {
        if (error.response) {
            const { status } = error.response;
            const responseData = JSON.stringify(error.response.data);

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
    }

    private static cleanCommitMessage(message: string): string {
        return message
            .replace(/^["']|["']$/g, '')
            .replace(/^(Here'?s? (is )?(a )?)?commit message:?\s*/i, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}

export async function generateAndSetCommitMessage(): Promise<void> {
    let notificationHandle: vscode.Progress<{ message?: string; increment?: number }> | undefined;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating Commit Message",
            cancellable: false
        }, async (progress) => {
            notificationHandle = progress;

            const repos = await GitService.getRepositories();
            const selectedRepo = await GitService.selectRepository(repos);

            if (!selectedRepo || !selectedRepo.rootUri) {
                throw new Error('No repository selected or repository has no root URI.');
            }

            const repoPath = selectedRepo.rootUri.fsPath;
            const onlyStagedChanges = ConfigService.getOnlyStagedChanges();

            progress.report({ message: `Fetching Git diff${onlyStagedChanges ? ' (staged changes only)' : ''}...`, increment: 0 });
            const diff = await GitService.getDiff(repoPath, onlyStagedChanges);
            void Logger.log(`Git diff fetched successfully. Length: ${diff.length} characters`);

            progress.report({ message: "Analyzing changes...", increment: 25 });
            const changedFiles = await GitService.getChangedFiles(repoPath, onlyStagedChanges);
            let blameAnalysis = '';
            for (const file of changedFiles) {
                const filePath = vscode.Uri.file(path.join(repoPath, file));
                try {
                    const fileBlameAnalysis = await analyzeFileChanges(filePath.fsPath);
                    blameAnalysis += `File: ${file}\n${fileBlameAnalysis}\n\n`;
                } catch (error) {
                    void Logger.error(`Error analyzing file ${file}:`, error as Error);
                    blameAnalysis += `File: ${file}\nUnable to analyze: ${(error as Error).message}\n\n`;
                }
            }

            progress.report({ message: "Generating commit message...", increment: 50 });
            const { message: commitMessage, model } = await AIService.generateCommitMessage(diff, blameAnalysis, progress);
            void Logger.log('Commit message generated successfully');

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
            void Logger.log('Commit message set successfully');

            progress.report({ message: "", increment: 100 });

            await new Promise(resolve => setTimeout(resolve, 100));

            void vscode.window.showInformationMessage(
                `Commit message set successfully (${model})`,
                { modal: false }
            );
        });
    } catch (error) {
        if (notificationHandle) {
            notificationHandle.report({ message: "" });
        }

        void Logger.error('Error in command execution:', error as Error);
        void vscode.window.showErrorMessage(
            `Error: ${(error as Error).message}`,
            { modal: false }
        );
    }
}