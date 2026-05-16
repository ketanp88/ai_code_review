import { DiffFile } from './diff-parser';
import { AGENT_FILE_RULES }
    from '../config/agent-file-rules';

export function filterDiffForAgent(agentName: string, files: DiffFile[]
): string {

    const rules =
        AGENT_FILE_RULES[
            agentName as keyof typeof AGENT_FILE_RULES
        ];

    if (!rules) {
        return '';
    }

    if (rules.includes('*')) {

        return files
            .map(f => f.content)
            .join('\n');
    }

    const filteredFiles = files.filter(file => {

        return rules.some(rule => {

            if (rule.startsWith('.')) {

                return file.filePath.endsWith(rule);
            }

            return file.filePath.includes(rule);
        });
    });

    return filteredFiles
        .map(f => f.content)
        .join('\n');
}

export function hasFilesForAgent(
    agentName: string,
    files: DiffFile[]
): boolean {
    return filterDiffForAgent(agentName, files).trim().length > 0;
}