import { DiffFile } from '../services/diff-parser';

import { normalizeFilePathForAzure } from './PullRequestDiffService';

export interface RightSideLineInfo {
    text: string;
    /** True if this right-side line came from a `+` row (changed/added), not context ` `. */
    isInsertion: boolean;
}

/** Max distance to snap an AI line to the nearest line present on the PR diff right side. */
function snapMaxDistance(): number {
    const raw = process.env.AI_PR_COMMENT_LINE_SNAP_MAX?.trim();
    if (!raw) {
        return 8;
    }
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 8;
}

const HUNK_HEADER =
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Walk unified diff hunks and collect every line number on the **right**
 * (post-change / PR source) side, with text and whether it is an insertion (`+`).
 */
export function extractRightSideLinesFromPatch(
    filePatchContent: string
): Map<number, RightSideLineInfo> {
    const out = new Map<number, RightSideLineInfo>();
    const lines = filePatchContent.split(/\r?\n/);

    let i = 0;
    while (i < lines.length) {
        const headerMatch = lines[i].match(HUNK_HEADER);
        if (!headerMatch) {
            i++;
            continue;
        }

        const newStart = parseInt(headerMatch[3], 10);
        let newLine = newStart;
        i++;

        while (i < lines.length) {
            const row = lines[i];
            if (row.startsWith('diff --git ')) {
                break;
            }
            if (row.startsWith('@@')) {
                break;
            }
            if (
                row.startsWith('diff --git ') ||
                row.startsWith('--- ') ||
                row.startsWith('+++ ') ||
                row.startsWith('index ') ||
                row.startsWith('new file mode') ||
                row.startsWith('deleted file mode') ||
                row.startsWith('similarity index')
            ) {
                i++;
                continue;
            }

            if (row === '') {
                i++;
                continue;
            }

            const prefix = row[0];
            const body = row.slice(1);

            if (prefix === ' ') {
                out.set(newLine, { text: body, isInsertion: false });
                newLine++;
            } else if (prefix === '-') {
                /* old side only — does not advance newLine */
            } else if (prefix === '+') {
                out.set(newLine, { text: body, isInsertion: true });
                newLine++;
            } else if (prefix === '\\') {
                i++;
                continue;
            }

            i++;
        }
    }

    return out;
}

function patchKeysForFile(diffPath: string): string[] {
    const norm = normalizeFilePathForAzure(diffPath);
    const noSlash = norm.replace(/^\/+/, '');
    const keys = new Set<string>([norm, '/' + noSlash, noSlash]);
    return [...keys];
}

/** Per-file map: new-file line number → line info */
export type RightSideLineMaps = Map<string, Map<number, RightSideLineInfo>>;

export function buildRightSideLineMaps(files: DiffFile[]): RightSideLineMaps {
    const maps = new Map<string, Map<number, RightSideLineInfo>>();

    for (const f of files) {
        const lineMap = extractRightSideLinesFromPatch(f.content);
        if (lineMap.size === 0) {
            continue;
        }
        for (const key of patchKeysForFile(f.filePath)) {
            maps.set(key, lineMap);
        }
    }

    return maps;
}

function pickMapForFinding(
    maps: RightSideLineMaps,
    normalizedFindingPath: string
): Map<number, RightSideLineInfo> | undefined {
    const n = normalizedFindingPath.replace(/\\/g, '/');
    const primary = n.startsWith('/') ? n : `/${n}`;
    if (maps.has(primary)) {
        return maps.get(primary);
    }
    const trimmed = primary.replace(/^\/+/, '');
    if (maps.has(trimmed)) {
        return maps.get(trimmed);
    }
    if (maps.has(`/${trimmed}`)) {
        return maps.get(`/${trimmed}`);
    }

    const tail = trimmed.includes('/')
        ? trimmed.slice(trimmed.lastIndexOf('/') + 1)
        : trimmed;
    const candidates: string[] = [];
    for (const k of maps.keys()) {
        const kTrim = k.replace(/^\/+/, '');
        if (
            k === primary ||
            k.endsWith('/' + trimmed) ||
            kTrim.endsWith('/' + trimmed) ||
            k.endsWith('/' + tail)
        ) {
            candidates.push(k);
        }
    }

    if (candidates.length === 1) {
        return maps.get(candidates[0]);
    }

    return undefined;
}

/**
 * Among lines within maxDist of candidate, pick the best anchor:
 * 1) minimum |Δ|
 * 2) prefer insertion (`+`) lines at that distance (actual changes)
 * 3) on ties, prefer higher line number (avoids snapping “above” when distances tie)
 */
function normalizeLineForMatch(text: string): string {
    return text.replace(/\r\n?$/, '').replace(/\s+/g, ' ').trim();
}

function collectNeedle(seen: Set<string>, out: string[], raw: string): void {
    const n = normalizeLineForMatch(raw);
    if (n.length < 8 || seen.has(n)) {
        return;
    }
    seen.add(n);
    out.push(n);
}

/** Lines long enough to disambiguate (skip `{`, `}`, blank). */
function needlesFromSnippet(snippet: string | undefined): string[] {
    if (!snippet?.trim()) {
        return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of snippet.split(/\r?\n/)) {
        collectNeedle(seen, out, raw);
    }
    return out;
}

/** Quoted / backticked spans plus code-like tokens from review prose. */
function needlesFromProse(...texts: (string | undefined)[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const combined = texts.filter(Boolean).join('\n');
    if (!combined.trim()) {
        return [];
    }

    const quotePatterns = [
        /`([^`\n]+)`/g,
        /'([^'\n]+)'/g,
        /"([^"\n]+)"/g,
    ];
    for (const re of quotePatterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(combined)) !== null) {
            collectNeedle(seen, out, m[1]);
        }
    }

    const codePatterns = [
        /await\s+this\.sleep\s*\(\s*\d+\s*\)/gi,
        /this\.sleep\s*\(\s*\d+\s*\)/gi,
        /\bsleep\s*\(\s*\d+\s*\)/gi,
        /\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(\s*\)/g,
    ];
    for (const re of codePatterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(combined)) !== null) {
            collectNeedle(seen, out, m[0]);
        }
    }

    const sleepSeconds = combined.match(/(\d+)\s*s\s*sleep/i);
    if (sleepSeconds) {
        const n = sleepSeconds[1];
        collectNeedle(seen, out, `sleep(${n})`);
        collectNeedle(seen, out, `await this.sleep(${n})`);
    }

    return out;
}

function buildNeedles(options?: ResolveLineOptions): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (n: string) => {
        if (!seen.has(n)) {
            seen.add(n);
            out.push(n);
        }
    };
    for (const n of needlesFromSnippet(options?.codeSnippet)) {
        add(n);
    }
    for (const n of needlesFromProse(
        options?.title,
        options?.explanation,
        options?.recommendation
    )) {
        add(n);
    }
    return out;
}

/** Title/explanation mention code that is not on the candidate line (e.g. sleep vs openAISupport). */
function lineMatchesFindingIntent(
    info: RightSideLineInfo,
    options?: ResolveLineOptions
): boolean {
    const prose = [options?.title, options?.explanation, options?.recommendation]
        .filter(Boolean)
        .join(' ');
    if (!prose.trim()) {
        return true;
    }

    const norm = normalizeLineForMatch(info.text);

    const sleepMatch =
        prose.match(/(\d+)\s*s\s*sleep/i) ??
        prose.match(/sleep\s*\(\s*(\d+)\s*\)/i);
    if (sleepMatch) {
        const sec = sleepMatch[1];
        if (
            !norm.includes(`sleep(${sec}`) &&
            !norm.includes(`sleep( ${sec}`)
        ) {
            return false;
        }
    }

    if (/\bverifyAIResponse\b/i.test(prose) && !norm.includes('verifyAIResponse')) {
        return false;
    }

    return true;
}

function linesMatchingNeedles(
    fileMap: Map<number, RightSideLineInfo>,
    needles: string[]
): number[] {
    if (needles.length === 0) {
        return [];
    }
    const hits: number[] = [];
    for (const [lineNo, info] of fileMap) {
        const norm = normalizeLineForMatch(info.text);
        if (!norm) {
            continue;
        }
        if (needles.some(n => norm === n || norm.includes(n) || n.includes(norm))) {
            hits.push(lineNo);
        }
    }
    return hits;
}

function pickClosestLine(lines: number[], target: number): number {
    return lines.reduce((best, x) =>
        Math.abs(x - target) < Math.abs(best - target) ? x : best
    );
}

function pickBestContentLine(
    hits: number[],
    fileMap: Map<number, RightSideLineInfo>,
    needles: string[],
    candidateLine: number
): number {
    const insertions = hits.filter(l => fileMap.get(l)?.isInsertion);
    const pool = insertions.length > 0 ? insertions : hits;

    let bestNeedleLen = 0;
    let best: number[] = [];
    for (const ln of pool) {
        const norm = normalizeLineForMatch(fileMap.get(ln)!.text);
        for (const n of needles) {
            if (!norm.includes(n) && !n.includes(norm)) {
                continue;
            }
            if (n.length > bestNeedleLen) {
                bestNeedleLen = n.length;
                best = [ln];
            } else if (n.length === bestNeedleLen) {
                best.push(ln);
            }
        }
    }
    if (best.length === 1) {
        return best[0];
    }
    if (best.length > 1) {
        return pickClosestLine(best, candidateLine);
    }
    if (pool.length === 1) {
        return pool[0];
    }
    return pickClosestLine(pool, candidateLine);
}

/**
 * Resolve line from codeSnippet / changed lines when the model line is missing or wrong.
 */
function resolveLineByContent(
    fileMap: Map<number, RightSideLineInfo>,
    candidateLine: number,
    needles: string[]
): number | null {
    const hits = linesMatchingNeedles(fileMap, needles);
    if (hits.length === 0) {
        return null;
    }
    return pickBestContentLine(hits, fileMap, needles, candidateLine);
}

function lineMatchesNeedles(
    info: RightSideLineInfo,
    needles: string[]
): boolean {
    if (needles.length === 0) {
        return true;
    }
    const norm = normalizeLineForMatch(info.text);
    if (!norm) {
        return false;
    }
    return needles.some(n => norm === n || norm.includes(n) || n.includes(norm));
}

function pickBestSnapLine(
    sortedLines: number[],
    candidate: number,
    maxDist: number,
    lineInfo: Map<number, RightSideLineInfo>,
    needles: string[] = []
): number | null {
    let bestDist = maxDist + 1;
    const pool: number[] = [];

    for (const x of sortedLines) {
        const d = Math.abs(x - candidate);
        if (d > maxDist) {
            continue;
        }
        if (d < bestDist) {
            bestDist = d;
            pool.length = 0;
            pool.push(x);
        } else if (d === bestDist) {
            pool.push(x);
        }
    }

    if (pool.length === 0) {
        return null;
    }

    const contentMatches = pool.filter(x =>
        lineMatchesNeedles(lineInfo.get(x)!, needles)
    );
    if (needles.length > 0 && contentMatches.length === 0) {
        return null;
    }
    const contentPool = contentMatches.length > 0 ? contentMatches : pool;

    if (contentPool.length === 1) {
        return contentPool[0];
    }

    const insertions = contentPool.filter(x => lineInfo.get(x)?.isInsertion);
    const narrowed = insertions.length > 0 ? insertions : contentPool;
    return Math.max(...narrowed);
}

export interface ResolvedCommentLine {
    lineNumber: number;
    /** Text on that line from the unified diff right side (for Azure offsets). */
    sourceLineText?: string;
    /** Model line differed from anchor Azure used. */
    adjusted: boolean;
    /** False when the line is not on the PR diff and cannot be resolved — do not post inline. */
    anchorable: boolean;
}

/**
 * Maps model `(file, line)` to a line that exists on the PR diff **right** side.
 * Azure threads anchor to those coordinates; model counts often drift by a few lines.
 */
export interface ResolveLineOptions {
    codeSnippet?: string;
    title?: string;
    explanation?: string;
    recommendation?: string;
}

export function resolveLineAgainstDiff(
    maps: RightSideLineMaps | null | undefined,
    findingFilePath: string,
    candidateLine: number,
    options?: ResolveLineOptions
): ResolvedCommentLine {
    const line = Math.max(1, Math.floor(candidateLine));
    const needles = buildNeedles(options);

    if (!maps || maps.size === 0) {
        console.warn(
            `[AI Code Pilot][Azure] no PR diff line map — cannot verify line ${line} for "${findingFilePath}"`
        );
        return { lineNumber: line, adjusted: false, anchorable: false };
    }

    const norm = normalizeFilePathForAzure(findingFilePath);
    const fileMap = pickMapForFinding(maps, norm);

    if (!fileMap || fileMap.size === 0) {
        console.warn(
            `[AI Code Pilot][Azure] no diff hunks for "${norm}" — inline comment skipped (line ${line})`
        );
        return { lineNumber: line, adjusted: false, anchorable: false };
    }

    const byContent = resolveLineByContent(fileMap, line, needles);
    if (byContent != null) {
        const info = fileMap.get(byContent)!;
        if (byContent !== line) {
            console.log(
                `[AI Code Pilot][Azure] anchored "${norm}" at line ${byContent} via codeSnippet (model line ${line})`
            );
        }
        return {
            lineNumber: byContent,
            sourceLineText: info.text,
            adjusted: byContent !== line,
            anchorable: true,
        };
    }

    if (fileMap.has(line)) {
        const info = fileMap.get(line)!;
        if (
            lineMatchesNeedles(info, needles) &&
            lineMatchesFindingIntent(info, options)
        ) {
            return {
                lineNumber: line,
                sourceLineText: info.text,
                adjusted: false,
                anchorable: true,
            };
        }
    }

    const sorted = [...fileMap.keys()].sort((a, b) => a - b);
    const maxDist = snapMaxDistance();
    const snapped = pickBestSnapLine(sorted, line, maxDist, fileMap, needles);

    if (snapped == null) {
        console.warn(
            `[AI Code Pilot][Azure] line ${line} not on PR diff right side for "${norm}" (snap max ${maxDist}) — inline comment skipped`
        );
        return { lineNumber: line, adjusted: false, anchorable: false };
    }

    const info = fileMap.get(snapped)!;
    if (snapped !== line) {
        console.log(
            `[AI Code Pilot][Azure] snapped "${norm}" from line ${line} to ${snapped}`
        );
    }
    return {
        lineNumber: snapped,
        sourceLineText: info.text,
        adjusted: snapped !== line,
        anchorable: true,
    };
}
