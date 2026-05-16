import axios from 'axios';
import { buildPrompt } from './prompt-builder';
import aiSettings from '../AISettings.json';
import { parseDiffFiles } from './diff-parser';
import { AiReviewResult } from '../models/ai-review-result';
import { extractResponseText } from './extract-response-text';
import { parseAiJson } from './parse-ai-json';

function firstNonEmpty(
    ...values: (string | undefined)[]
): string | undefined {
    for (const v of values) {
        const t = v?.trim();
        if (t) {
            return t;
        }
    }
    return undefined;
}

/** Non-empty string from `AISettings.json` fields only (trim + strip quotes). */
function aiSettingsString(value: string | undefined): string | undefined {
    const t = value?.trim();
    if (!t) {
        return undefined;
    }
    return stripSurroundingQuotes(t);
}

function stripSurroundingQuotes(value: string): string {
    let s = value.trim();
    if (
        (s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'"))
    ) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

/**
 * Resolves and validates the chat/completions (or compatible) base URL
 * from `AISettings.json` only (`AIModelEndpoint`).
 */
function resolveValidatedAiEndpoint(): string {
    const raw = aiSettingsString(aiSettings.AIModelEndpoint);

    if (!raw) {
        throw new Error(
            'AI endpoint missing: set AIModelEndpoint in AISettings.json to your full https chat/completions URL (or compatible API base).'
        );
    }

    let candidate = raw;

    if (/^(null|undefined)$/i.test(candidate)) {
        throw new Error(
            'AIModelEndpoint in AISettings.json is a placeholder. Set a real https URL for your Azure OpenAI or API endpoint.'
        );
    }

    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
        if (
            /\.openai\.azure\.com/i.test(candidate) ||
            /\.cognitiveservices\.azure\.com/i.test(candidate) ||
            /\.azure-api\.net/i.test(candidate)
        ) {
            candidate = `https://${candidate.replace(/^\/+/, '')}`;
        }
    }

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(
                `AI endpoint must use http: or https:. Got: ${JSON.stringify(candidate.slice(0, 160))}`
            );
        }
    } catch (e: unknown) {
        if (e instanceof TypeError) {
            throw new Error(
                `AI endpoint is not a valid HTTP(S) URL. First 160 chars: ${JSON.stringify(candidate.slice(0, 160))}`
            );
        }
        throw e;
    }

    return candidate.replace(/\/+$/, '');
}

export interface AgentResult {
    agentName: string;
    review: AiReviewResult;
}

export async function runAgent(
    agentName: string,
    diff: string
): Promise<AgentResult> {

    const endpoint = resolveValidatedAiEndpoint();
    const apiKey = aiSettingsString(aiSettings.AIModelKey);
    const model = firstNonEmpty(
        aiSettingsString(aiSettings.ModelName),
        aiSettingsString(aiSettings.ModelDeploymentName)
    );

    if (!apiKey) {
        throw new Error(
            'AI API key missing: set AIModelKey in AISettings.json.'
        );
    }
    if (!model) {
        throw new Error(
            'AI model / deployment name missing: set ModelName or ModelDeploymentName in AISettings.json.'
        );
    }

    const parsedFiles = parseDiffFiles(diff);

    const prompt = buildPrompt({
        agentName,
        diff
    });

    const modelInput = {
        repository: process.env.BUILD_REPOSITORY_NAME ?? '',
        pullRequestId:
            firstNonEmpty(
                process.env.SYSTEM_PULLREQUEST_PULLREQUESTID,
                process.env.BUILD_SOURCEVERSIONMESSAGE
            ) ?? '',
        agent: agentName,
        instructions: prompt,
        parsedFiles,
        diff
    };

    let response;
    try {
        response = await axios.post(
            endpoint,
            {
                model,
                input: [
                    {
                        role: 'user',
                        content: JSON.stringify(modelInput)
                    }
                ]
            },
            {
                headers: {
                    'api-key': apiKey,
                    'Content-Type': 'application/json',
                },
            }
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Invalid URL')) {
            throw new Error(
                `AI HTTP request failed: Invalid URL. Resolved endpoint from AISettings.json (truncated): ${JSON.stringify(endpoint.slice(0, 200))}. Set AIModelEndpoint to a full URL (e.g. https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=...). Original error: ${msg}`
            );
        }
        throw err;
    }

    if (
        process.env.AI_CODE_PILOT_VERBOSE?.trim().toLowerCase() === 'true'
    ) {
        console.log(JSON.stringify(response.data, null, 2));
    }

    const text = extractResponseText(response.data);
    const parsed = parseAiJson<AiReviewResult>(text);

    return {
        agentName,
        review: parsed
    };
}
