        void Logger.log(`Getting diff for repository: ${repoPath}, onlyStaged: ${onlyStaged}`);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    void Logger.log(`Error reading content of ${file}: ${errorMessage}`);
                if (code !== 0) {
                    reject(new Error(`Git ${args.join(' ')} failed with code ${code}: ${stderr}`));
                } else {
                    resolve(stdout);
                }
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!extension) {
            throw new GitExtensionNotFoundError();
        }
        const gitExtension = await extension.activate();
        const git = gitExtension.getAPI(1);

        if (!git?.repositories?.length) {
            throw new NoRepositoriesFoundError();
        }
        return git.repositories;
        if (repos.length === 1) {
            return repos[0];
        }
        if (!selected) {
            throw new NoRepositorySelectedError();
        }
    getAPI(version: 1): {
        repositories: vscode.SourceControl[];
    };