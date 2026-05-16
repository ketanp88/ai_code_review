export interface DiffFile {
    filePath: string;
    content: string;
}

export function parseDiffFiles(
    diff: string
): DiffFile[] {

    const lines = diff.split('\n');

    const files: DiffFile[] = [];

    let currentFile = '';
    let currentContent: string[] = [];

    for (const line of lines) {

        if (line.startsWith('diff --git')) {

            if (currentFile) {

                files.push({
                    filePath: currentFile,
                    content: currentContent.join('\n')
                });
            }

            const match = line.match(
                /diff --git a\/(.+?) b\/(.+)/
            );

            currentFile = match?.[2] ?? 'unknown';

            currentContent = [line];

        } else {

            currentContent.push(line);
        }
    }

    if (currentFile) {

        files.push({
            filePath: currentFile,
            content: currentContent.join('\n')
        });
    }

    return files;
}