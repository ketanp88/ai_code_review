/**
 * Normalizes file paths for Azure DevOps threadContext (repo-root paths with leading /).
 */
export function normalizeFilePathForAzure(filePath: string): string {
    let normalized = filePath.trim().replace(/\\/g, '/');
    if (normalized.startsWith('./')) {
        normalized = normalized.slice(2);
    }
    if (!normalized.startsWith('/')) {
        normalized = `/${normalized}`;
    }
    return normalized;
}

/**
 * Azure DevOps PR thread `rightFileStart` / `rightFileEnd` use **1-based** character offsets
 * within the line on the PR **right** (target) file. Anchor on the first non-whitespace through
 * the last non-whitespace so the comment highlights real code, not leading spaces/tabs.
 */
export function azureThreadOffsetsFromSourceLine(
    sourceLineText: string | undefined
): { startOffset: number; endOffset: number } {
    if (sourceLineText == null || sourceLineText === '') {
        return { startOffset: 1, endOffset: 1 };
    }

    const line = sourceLineText.replace(/\r\n?$/, '');
    let i = 0;
    while (i < line.length && /\s/u.test(line[i])) {
        i++;
    }

    if (i >= line.length) {
        return { startOffset: 1, endOffset: Math.min(Math.max(1, line.length), 8192) };
    }

    let j = line.length - 1;
    while (j > i && /\s/u.test(line[j])) {
        j--;
    }

    const startOffset = i + 1;
    const endOffset = j + 1;

    const cappedEnd = Math.min(Math.max(startOffset, endOffset), 8192);
    const cappedStart = Math.min(startOffset, cappedEnd);

    return { startOffset: cappedStart, endOffset: cappedEnd };
}
