export function extractResponseText(
    response: any
): string {

    if (!response) {

        console.error(
            'AI response object is null.'
        );

        return '';
    }

    if (!Array.isArray(response.output)) {

        console.error(
            'AI response.output missing.'
        );

        console.error(
            JSON.stringify(response, null, 2)
        );

        return '';
    }

    const texts: string[] = [];

    for (const outputItem of response.output) {

        if (outputItem.type !== 'message') {
            continue;
        }

        if (!Array.isArray(outputItem.content)) {
            continue;
        }

        for (const contentItem of outputItem.content) {

            if (
                contentItem.type === 'output_text' &&
                typeof contentItem.text === 'string'
            ) {
                texts.push(contentItem.text);
            }
        }
    }

    return texts.join('\n').trim();
}