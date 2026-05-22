export interface DiffFile {
    filePath: string;
    content: string;
}

/** Parse `diff --git a/... b/...` (quoted paths supported). */
function parseDiffGitLine(line: string): string | null {
    const trimmed = line.replace(/^\uFEFF/, '').trimStart();
    if (!trimmed.startsWith('diff --git ')) {
        return null;
    }

    const rest = trimmed.slice('diff --git '.length);
    const quoted = rest.match(
        /^"a\/(.+)"\s+"b\/(.+)"$/
    );
    if (quoted) {
        return quoted[2];
    }

    const standard = rest.match(/^a\/(.+?)\s+b\/(.+)$/);
    return standard ? standard[2] : null;
}

export function parseDiffFiles(diff: string): DiffFile[] {
    const lines = diff.split(/\r?\n/);

    const files: DiffFile[] = [];

    let currentFile = '';
    let currentContent: string[] = [];

    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');

        if (line.startsWith('diff --git')) {
            if (currentFile) {
                files.push({
                    filePath: currentFile,
                    content: currentContent.join('\n'),
                });
            }

            currentFile = parseDiffGitLine(line) ?? 'unknown';
            currentContent = [line];
        } else {
            currentContent.push(line);
        }
    }

    if (currentFile) {
        files.push({
            filePath: currentFile,
            content: currentContent.join('\n'),
        });
    }

    return files;
}
