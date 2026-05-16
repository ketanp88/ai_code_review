export function applyTemplate(
    template: string,
    variables: Record<string, string>
): string {

    let result = template;

    for (const key in variables) {

        const value = variables[key];

        result = result.replaceAll(
            `{{${key}}}`,
            value
        );
    }

    return result;
}