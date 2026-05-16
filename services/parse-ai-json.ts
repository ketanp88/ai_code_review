export function parseAiJson<T>(
    text: string
): T {

    if (!text?.trim()) {

        throw new Error(
            'AI response text is empty.'
        );
    }

    let cleaned = text.trim();

    // Remove markdown fences
    cleaned = cleaned.replace(
        /^```json/i,
        ''
    );

    cleaned = cleaned.replace(
        /^```/,
        ''
    );

    cleaned = cleaned.replace(
        /```$/,
        ''
    );

    cleaned = cleaned.trim();

    // Find first JSON object
    const firstBrace = cleaned.indexOf('{');

    const lastBrace = cleaned.lastIndexOf('}');

    if (
        firstBrace === -1 ||
        lastBrace === -1
    ) {
        throw new Error(
            'No JSON object found in AI response.'
        );
    }

    cleaned = cleaned.substring(
        firstBrace,
        lastBrace + 1
    );

    try {

        return JSON.parse(cleaned) as T;

    } catch (error) {

        console.error(
            'Failed to parse AI JSON response'
        );

        console.error(cleaned);

        throw error;
    }
}