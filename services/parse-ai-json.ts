/**
 * Tolerant JSON extractor for AI model output.
 *
 * Strategy:
 *   1. Try `JSON.parse` on the raw text — handles the common case where the
 *      model obeyed the "return only JSON" instruction.
 *   2. Strip markdown fences (``` or ```json) and retry.
 *   3. Walk the cleaned text with a string-and-escape-aware brace counter to
 *      find ALL balanced top-level `{ ... }` objects, ignoring braces inside
 *      JSON strings. (Old code did `indexOf('{')` / `lastIndexOf('}')` and was
 *      fooled by prose like "use `{user.name}` here".)
 *   4. Try each candidate, largest first, returning the first one that parses
 *      as JSON. The largest-first ordering picks the real agent JSON over any
 *      small `{}` or `{some.prop}` curly that appears in the model's prose.
 */

function stripMarkdownFences(text: string): string {
    let cleaned = text.trim();

    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```\s*$/i, '');

    return cleaned.trim();
}

function findAllBalancedJsonObjects(text: string): string[] {
    const objects: string[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (inString) {
            if (ch === '\\') {
                escapeNext = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{') {
            if (depth === 0) {
                start = i;
            }
            depth++;
        } else if (ch === '}') {
            if (depth === 0) {
                continue;
            }
            depth--;
            if (depth === 0 && start >= 0) {
                objects.push(text.slice(start, i + 1));
                start = -1;
            }
        }
    }

    return objects;
}

export function parseAiJson<T>(text: string): T {
    if (!text?.trim()) {
        throw new Error('AI response text is empty.');
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        // fall through
    }

    const fenced = stripMarkdownFences(text);

    if (fenced !== text.trim()) {
        try {
            return JSON.parse(fenced) as T;
        } catch {
            // fall through
        }
    }

    const candidates = findAllBalancedJsonObjects(fenced);
    if (candidates.length === 0) {
        throw new Error('No JSON object found in AI response.');
    }

    const sortedByLength = [...candidates].sort((a, b) => b.length - a.length);

    let lastError: unknown = null;
    for (const candidate of sortedByLength) {
        try {
            return JSON.parse(candidate) as T;
        } catch (error) {
            lastError = error;
        }
    }

    console.error(
        `All ${candidates.length} extracted JSON candidate(s) failed to parse. ` +
        `Largest candidate (first ${Math.min(400, sortedByLength[0].length)} chars):`
    );
    console.error(sortedByLength[0].slice(0, 400));
    throw lastError instanceof Error
        ? lastError
        : new Error('Failed to parse AI JSON.');
}
