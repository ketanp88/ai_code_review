import fs from 'fs';
import path from 'path';
import { applyTemplate } from './template-engine';

export interface PromptBuilderOptions {
    agentName: string;
    diff: string;
    repositoryStandards?: string;
    testResults?: string;
}

function loadPrompt(relativePath: string): string {

    const fullPath = path.join(
        __dirname,
        '..',
        relativePath
    );

    return fs.readFileSync(fullPath, 'utf8');
}

export function buildPrompt(
    options: PromptBuilderOptions
): string {

    const systemPrompt = loadPrompt(
        'prompts/system/base-system.md'
    );

    const agentPrompt = loadPrompt(
        `prompts/agents/${options.agentName}.md`
    );

    const outputTemplate = loadPrompt(
        'prompts/templates/review-template.md'
    );

    const mainTemplate = loadPrompt(
        'prompts/templates/main-review-template.md'
    );

    return applyTemplate(
        mainTemplate,
        {
            systemPrompt,

            agentPrompt,

            repositoryStandards:
                options.repositoryStandards ?? 'N/A',

            testResults:
                options.testResults ?? 'N/A',

            diff: options.diff,

            outputTemplate
        }
    );
}