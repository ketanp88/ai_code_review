function collectOutputTextItems(
    content: unknown[]
): string[] {
    const texts: string[] = [];

    for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== 'object') {
            continue;
        }

        const item = contentItem as Record<string, unknown>;
        const type = item.type;

        if (
            (type === 'output_text' || type === 'text') &&
            typeof item.text === 'string'
        ) {
            texts.push(item.text);
        }
    }

    return texts;
}

function extractFromResponsesOutput(
    output: unknown[]
): string {
    const texts: string[] = [];

    for (const outputItem of output) {
        if (!outputItem || typeof outputItem !== 'object') {
            continue;
        }

        const item = outputItem as Record<string, unknown>;

        if (item.type === 'message' && Array.isArray(item.content)) {
            texts.push(...collectOutputTextItems(item.content));
            continue;
        }

        if (
            typeof item.text === 'string' &&
            (item.type === 'output_text' || item.type === 'text')
        ) {
            texts.push(item.text);
        }
    }

    return texts.join('\n').trim();
}

function extractFromChatChoices(
    choices: unknown[]
): string {
    const texts: string[] = [];

    for (const choice of choices) {
        if (!choice || typeof choice !== 'object') {
            continue;
        }

        const choiceObj = choice as Record<string, unknown>;
        const message = choiceObj.message;

        if (typeof choiceObj.text === 'string') {
            texts.push(choiceObj.text);
            continue;
        }

        if (!message || typeof message !== 'object') {
            continue;
        }

        const content = (message as Record<string, unknown>).content;

        if (typeof content === 'string') {
            texts.push(content);
            continue;
        }

        if (Array.isArray(content)) {
            texts.push(...collectOutputTextItems(content));
        }
    }

    return texts.join('\n').trim();
}

export function extractResponseText(
    response: unknown
): string {

    if (!response) {
        console.error('AI response object is null.');
        return '';
    }

    if (typeof response === 'string') {
        return response.trim();
    }

    if (typeof response !== 'object') {
        console.error(
            `AI response has unexpected type: ${typeof response}`
        );
        return '';
    }

    const data = response as Record<string, unknown>;

    if (typeof data.output_text === 'string' && data.output_text.trim()) {
        return data.output_text.trim();
    }

    if (Array.isArray(data.output)) {
        const fromOutput = extractFromResponsesOutput(data.output);
        if (fromOutput) {
            return fromOutput;
        }
    }

    if (Array.isArray(data.choices)) {
        const fromChoices = extractFromChatChoices(data.choices);
        if (fromChoices) {
            return fromChoices;
        }
    }

    if (typeof data.content === 'string' && data.content.trim()) {
        return data.content.trim();
    }

    if (typeof data.text === 'string' && data.text.trim()) {
        return data.text.trim();
    }

    console.error(
        'Could not extract text from AI response (expected Responses API `output`, chat `choices`, or `output_text`).'
    );

    console.error(
        JSON.stringify(response, null, 2)
    );

    return '';
}
