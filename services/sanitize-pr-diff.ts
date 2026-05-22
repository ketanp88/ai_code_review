/** Azure Pipelines console prefix on each logged line. */
const ADO_LOG_LINE_PREFIX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z (.*)$/;

/** Leading Azure Pipelines / task log noise (not part of git output). */
const ADO_LOG_NOISE_PREFIX =
    /^(##\[(?:section|command|error|warning)\]|={3,}|Task\s*:|Description\s*:|Version\s*:|Author\s*:|Help\s*:|Generating script\.|Starting:|Finishing:|C:\\|From https?:\/\/|\* branch\b)/i;

function normalizeDiffLine(line: string): string {
    return line.replace(/^﻿/, '').replace(/\r$/, '').trimStart();
}

function stripAdoLinePrefix(line: string): string {
    const match = line.match(ADO_LOG_LINE_PREFIX);
    return match ? match[1] : line;
}

/**
 * Strips Azure DevOps log prefixes and returns raw `git diff` text.
 * Accepts either a clean diff file or pipeline log output that includes one.
 */
export function sanitizePrDiffText(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) {
        return '';
    }

    const lines = trimmed.split(/\r?\n/);
    const stripped = lines.map(line => normalizeDiffLine(stripAdoLinePrefix(line)));

    const startIdx = stripped.findIndex(line =>
        line.startsWith('diff --git')
    );
    if (startIdx < 0) {
        return trimmed;
    }

    let endIdx = stripped.length;
    for (let i = startIdx + 1; i < stripped.length; i++) {
        const line = stripped[i];
        if (
            line.startsWith('##[section]Finishing:') ||
            line.startsWith('##[section]Starting:')
        ) {
            endIdx = i;
            break;
        }
        if (ADO_LOG_NOISE_PREFIX.test(line)) {
            endIdx = i;
            break;
        }
    }

    return stripped
        .slice(startIdx, endIdx)
        .filter(line => !ADO_LOG_NOISE_PREFIX.test(line))
        .join('\n')
        .trim();
}
