import { DiffFile } from './diff-parser';
import { fitModelInputContent } from './fit-model-input';

const CHUNK_HEADER =
    (index: number, total: number) =>
        `\n--- AI review chunk ${index} of ${total} ` +
        `(only assess files in this diff segment) ---\n`;

const HUNK_HEADER_REGEX = /^@@ /;

const truncationMarker = (omittedChars: number): string =>
    ` [TRUNCATED ${omittedChars} chars]`;

/**
 * Groups per-file diff hunks into strings that each stay under `maxDiffChars`.
 */
export function chunkDiffByFiles(
    files: DiffFile[],
    maxDiffChars: number
): string[] {
    if (maxDiffChars <= 0 || files.length === 0) {
        return [];
    }

    const chunks: string[] = [];
    let batch: string[] = [];
    let batchLen = 0;

    const flush = (): void => {
        if (batch.length > 0) {
            chunks.push(batch.join('\n'));
            batch = [];
            batchLen = 0;
        }
    };

    for (const file of files) {
        const piece = file.content;
        if (piece.length > maxDiffChars) {
            flush();
            chunks.push(...splitOversizedFileDiff(piece, maxDiffChars));
            continue;
        }

        const addedLen = batchLen === 0 ? piece.length : batchLen + 1 + piece.length;
        if (batch.length > 0 && addedLen > maxDiffChars) {
            flush();
        }

        batch.push(piece);
        batchLen = batch.length === 1 ? piece.length : batchLen + 1 + piece.length;
    }

    flush();
    return chunks;
}

interface ParsedHunk {
    header: string;
    body: string[];
}

interface ParsedFileDiff {
    fileHeader: string;
    hunks: ParsedHunk[];
}

function parseFileDiff(content: string): ParsedFileDiff {
    const allLines = content.split('\n');
    let firstHunkIdx = -1;
    for (let i = 0; i < allLines.length; i++) {
        if (HUNK_HEADER_REGEX.test(allLines[i])) {
            firstHunkIdx = i;
            break;
        }
    }

    if (firstHunkIdx < 0) {
        return { fileHeader: content, hunks: [] };
    }

    const fileHeader = allLines.slice(0, firstHunkIdx).join('\n');
    const hunks: ParsedHunk[] = [];
    let current: ParsedHunk | null = null;

    for (let i = firstHunkIdx; i < allLines.length; i++) {
        const line = allLines[i];
        if (HUNK_HEADER_REGEX.test(line)) {
            if (current) {
                hunks.push(current);
            }
            current = { header: line, body: [] };
        } else if (current) {
            current.body.push(line);
        }
    }
    if (current) {
        hunks.push(current);
    }

    return { fileHeader, hunks };
}

function renderHunk(hunk: ParsedHunk): string {
    return [hunk.header, ...hunk.body].join('\n');
}

function currentSize(lines: string[]): number {
    if (lines.length === 0) return 0;
    let n = 0;
    for (const line of lines) n += line.length + 1;
    return n - 1;
}

//
// Split a single oversized file diff so each sub-chunk keeps the original file
// header (the `diff --git`, `index`, `--- a/X`, `+++ b/X` lines). The latest
// hunk header is re-emitted with a continuation marker at the top of any
// chunk that doesn't already start with its own `@@`. Never slices mid-line;
// truncates with a marker instead.
//
function splitOversizedFileDiff(content: string, maxDiffChars: number): string[] {
    if (maxDiffChars <= 0) {
        return [];
    }

    const parsed = parseFileDiff(content);

    if (parsed.hunks.length === 0) {
        return splitLinesPreservingBoundaries(content.split('\n'), '', maxDiffChars);
    }

    const fileHeaderBlock = parsed.fileHeader.length > 0 ? parsed.fileHeader + '\n' : '';
    const headerOverhead = fileHeaderBlock.length;

    if (headerOverhead >= maxDiffChars) {
        return splitLinesPreservingBoundaries(content.split('\n'), '', maxDiffChars);
    }

    const parts: string[] = [];
    let batch: ParsedHunk[] = [];
    let batchLen = headerOverhead;

    const flushBatch = (): void => {
        if (batch.length === 0) return;
        const rendered = batch.map(h => renderHunk(h)).join('\n');
        parts.push(fileHeaderBlock + rendered);
        batch = [];
        batchLen = headerOverhead;
    };

    for (const hunk of parsed.hunks) {
        const renderedSize = renderHunk(hunk).length;
        const addedSize = batch.length === 0 ? renderedSize : 1 + renderedSize;

        if (batchLen + addedSize <= maxDiffChars) {
            batch.push(hunk);
            batchLen += addedSize;
            continue;
        }

        flushBatch();

        if (headerOverhead + renderedSize <= maxDiffChars) {
            batch.push(hunk);
            batchLen = headerOverhead + renderedSize;
            continue;
        }

        parts.push(...splitOversizedHunk(parsed.fileHeader, hunk, maxDiffChars));
    }

    flushBatch();
    return parts;
}

function splitOversizedHunk(
    fileHeader: string,
    hunk: ParsedHunk,
    maxDiffChars: number
): string[] {
    const fileHeaderBlock = fileHeader.length > 0 ? fileHeader + '\n' : '';
    const continuationSuffix = ' [continuation]';

    const buildPrefix = (continuation: boolean): string =>
        fileHeaderBlock +
        (continuation
            ? `${hunk.header}${continuationSuffix}\n`
            : `${hunk.header}\n`);

    const parts: string[] = [];
    let current: string[] = [];
    let isFirst = true;
    let currentPrefixLen = buildPrefix(false).length;

    const flush = (): void => {
        if (current.length === 0) return;
        parts.push(buildPrefix(!isFirst) + current.join('\n'));
        current = [];
        isFirst = false;
        currentPrefixLen = buildPrefix(true).length;
    };

    for (const line of hunk.body) {
        const lineLen = line.length + 1;
        const activePrefixLen = (!isFirst || parts.length > 0)
            ? buildPrefix(true).length
            : buildPrefix(false).length;
        const maxLineLen = maxDiffChars - activePrefixLen;

        if (lineLen > maxLineLen) {
            flush();
            const reserve = truncationMarker(0).length + 16;
            const room = Math.max(1, maxLineLen - reserve);
            const truncated = line.slice(0, room) + truncationMarker(line.length - room);
            parts.push(buildPrefix(true) + truncated);
            isFirst = false;
            continue;
        }

        if (currentPrefixLen + currentSize(current) + lineLen > maxDiffChars && current.length > 0) {
            flush();
        }
        current.push(line);
    }

    flush();
    return parts;
}

//
// Fallback splitter for diffs we couldn't parse into hunks. Splits by line and
// truncates any single line that is itself larger than the budget.
//
function splitLinesPreservingBoundaries(
    lines: string[],
    headerPrefix: string,
    maxDiffChars: number
): string[] {
    const parts: string[] = [];
    let current: string[] = [];
    let currentLen = headerPrefix.length;

    const flush = (): void => {
        if (current.length === 0) return;
        parts.push(headerPrefix + current.join('\n'));
        current = [];
        currentLen = headerPrefix.length;
    };

    for (const line of lines) {
        const lineLen = line.length + 1;
        const maxLineLen = maxDiffChars - headerPrefix.length;

        if (lineLen > maxLineLen) {
            flush();
            const reserve = truncationMarker(0).length + 16;
            const room = Math.max(1, maxLineLen - reserve);
            const truncated = line.slice(0, room) + truncationMarker(line.length - room);
            parts.push(headerPrefix + truncated);
            continue;
        }

        if (currentLen + lineLen > maxDiffChars && current.length > 0) {
            flush();
        }
        current.push(line);
        currentLen += lineLen;
    }
    flush();
    return parts;
}

function truncateChunkToFitPayload(
    buildPayload: (diff: string) => Record<string, unknown>,
    chunk: string
): string | null {
    let low = 0;
    let high = chunk.length;
    let best: string | null = null;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = chunk.slice(0, mid) + truncationMarker(chunk.length - mid);
        const fitted = fitModelInputContent(buildPayload, candidate);
        if (!fitted.truncated) {
            best = candidate;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return best;
}

/**
 * Subdivides any chunk whose JSON payload still exceeds the model limit.
 * Splits at line boundaries; for a single oversized line, truncates with a
 * marker rather than slicing mid-character.
 */
export function refineChunksToPayloadLimit(
    buildPayload: (diff: string) => Record<string, unknown>,
    chunks: string[]
): string[] {
    const result: string[] = [];

    for (const chunk of chunks) {
        if (!chunk.trim()) {
            continue;
        }

        const fitted = fitModelInputContent(buildPayload, chunk);
        if (!fitted.truncated) {
            result.push(chunk);
            continue;
        }

        const lines = chunk.split('\n');
        if (lines.length <= 1) {
            if (chunk.length <= 1) {
                throw new Error(
                    `Diff segment still too large for model input (${chunk.length} chars). ` +
                    `Increase MaxModelInputBytes or reduce PR size.`
                );
            }
            const truncated = truncateChunkToFitPayload(buildPayload, chunk);
            if (truncated == null) {
                throw new Error(
                    `Diff segment cannot be truncated to fit payload limit ` +
                    `(${chunk.length} chars). Increase MaxModelInputBytes.`
                );
            }
            result.push(truncated);
            continue;
        }

        const mid = Math.floor(lines.length / 2);
        const head = lines.slice(0, mid).join('\n');
        const tail = lines.slice(mid).join('\n');
        result.push(...refineChunksToPayloadLimit(buildPayload, [head, tail]));
    }

    return result;
}

export function withChunkHeaders(rawChunks: string[], agentName: string): string[] {
    const total = rawChunks.length;
    if (total <= 1) {
        return rawChunks;
    }

    return rawChunks.map((chunk, i) =>
        `[${agentName}]${CHUNK_HEADER(i + 1, total)}${chunk}`
    );
}
