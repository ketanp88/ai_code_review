import aiSettings from '../AISettings.json';

/** API max length for `input[0].content` (10 MiB). */
export const API_MAX_INPUT_CONTENT_LENGTH = 10_485_760;

/** Target max with headroom below the hard HTTP API limit. */
export const SAFE_MAX_INPUT_CONTENT_LENGTH = 9_000_000;

/**
 * Conservative payload cap so requests stay within model context windows
 * (token limits are far below the 10 MiB HTTP body limit).
 * Override with env `AI_CODE_PILOT_MAX_INPUT_BYTES` (positive integer).
 */
export const DEFAULT_MODEL_CONTEXT_INPUT_LENGTH = 500_000;

function parsePositiveInt(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.trim(), 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}

export function resolveMaxInputContentLength(): number {
    const fromEnv = parsePositiveInt(
        process.env.AI_CODE_PILOT_MAX_INPUT_BYTES
    );
    const fromSettings = parsePositiveInt(
        (aiSettings as { MaxModelInputBytes?: number }).MaxModelInputBytes
    );
    const chosen = fromEnv ?? fromSettings ?? DEFAULT_MODEL_CONTEXT_INPUT_LENGTH;
    return Math.min(chosen, SAFE_MAX_INPUT_CONTENT_LENGTH);
}

const TRUNCATION_NOTICE =
    '\n\n---\n**Note:** The PR diff was truncated to fit the model input limit. Review the omitted sections in Azure DevOps directly.\n---\n';

export interface FitModelInputResult {
    content: string;
    truncated: boolean;
}

/**
 * Largest diff character count that fits in one request (no truncation notice).
 * Used to size chunks for multi-pass agent reviews.
 */
export function maxDiffCharsThatFit(
    buildPayload: (diff: string) => Record<string, unknown>
): number {
    const maxLength = resolveMaxInputContentLength();
    if (JSON.stringify(buildPayload('')).length >= maxLength) {
        return 0;
    }

    let low = 0;
    let high = 8_000_000;

    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const content = JSON.stringify(buildPayload('x'.repeat(mid)));
        if (content.length <= maxLength) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    return low;
}

/**
 * Serializes `buildPayload(diff)` as JSON and, if needed, truncates `diff`
 * so the result stays within {@link SAFE_MAX_INPUT_CONTENT_LENGTH}.
 */
export function fitModelInputContent(
    buildPayload: (diff: string) => Record<string, unknown>,
    diff: string
): FitModelInputResult {
    const maxLength = resolveMaxInputContentLength();
    const initial = JSON.stringify(buildPayload(diff));
    if (initial.length <= maxLength) {
        return { content: initial, truncated: false };
    }

    let low = 0;
    let high = diff.length;
    let bestContent = '';

    while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        const candidateDiff = diff.slice(0, mid) + TRUNCATION_NOTICE;
        const content = JSON.stringify(buildPayload(candidateDiff));
        if (content.length <= maxLength) {
            low = mid;
            bestContent = content;
        } else {
            high = mid - 1;
        }
    }

    if (low === 0 || !bestContent) {
        throw new Error(
            `AI review input exceeds limit even after truncating the PR diff ` +
            `(initial ${initial.length} bytes, max ${maxLength}). ` +
            `Reduce PR size or split the pull request.`
        );
    }

    console.warn(
        `PR diff truncated for model input limit: ${diff.length} → ${low} chars ` +
        `(payload ${bestContent.length} bytes, limit ${maxLength})`
    );

    return { content: bestContent, truncated: true };
}
