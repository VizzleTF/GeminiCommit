    static async getDiff(repoPath: string, onlyStaged: boolean = false): Promise<string> {
        Logger.log(`Getting diff for repository: ${repoPath}, onlyStaged: ${onlyStaged}`);

        const stagedDiff = await this.executeGitCommand(['diff', '--staged'], repoPath);

        if (stagedDiff.trim()) {
            return stagedDiff;
        }

        if (onlyStaged) {
            throw new NoChangesDetectedError('No staged changes detected.');
        }

        const unstaged = await this.executeGitCommand(['diff'], repoPath);

        const untrackedFiles = await this.getUntrackedFiles(repoPath);

        let untrackedContent = '';
        if (untrackedFiles.length > 0) {
            for (const file of untrackedFiles) {
                untrackedContent += `diff --git a/${file} b/${file}\n`;
                untrackedContent += `new file mode 100644\n`;
                untrackedContent += `--- /dev/null\n`;
                untrackedContent += `+++ b/${file}\n`;

                try {
                    const fileContent = await this.executeGitCommand(['show', `:${file}`], repoPath).catch(() => '');
                    if (fileContent) {
                        untrackedContent += fileContent.split('\n')
                            .map(line => `+${line}`)
                            .join('\n');
                        untrackedContent += '\n';
                    }
                } catch (error) {
                    Logger.log(`Error reading content of ${file}: ${error}`);
                }
            }
        }

        const combinedDiff = unstaged + (untrackedContent ? '\n' + untrackedContent : '');

        if (!combinedDiff.trim()) {
            throw new NoChangesDetectedError('No changes detected.');
        }

        return combinedDiff;
    }

    private static async getUntrackedFiles(repoPath: string): Promise<string[]> {
        const command = ['ls-files', '--others', '--exclude-standard'];
        const output = await this.executeGitCommand(command, repoPath);
        return output.split('\n').filter(line => line.trim() !== '');
    static async getChangedFiles(repoPath: string, onlyStaged: boolean = false): Promise<string[]> {
        const statusCommand = ['status', '--porcelain'];
        const output = await this.executeGitCommand(statusCommand, repoPath);
            .filter(line => !onlyStaged || line[0] === 'M' || line[0] === 'A' || line[0] === 'D' || line[0] === 'R')