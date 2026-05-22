import axios, { AxiosResponse } from 'axios';
import { buildPrompt } from './prompt-builder';
import aiSettings from '../AISettings.json';
import { AiReviewResult } from '../models/ai-review-result';
import { extractResponseText } from './extract-response-text';
import { parseAiJson } from './parse-ai-json';
import { fitModelInputContent } from './fit-model-input';

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

/** True when the configured URL targets the OpenAI / Azure Responses API. */
function usesResponsesApi(endpoint: string): boolean {
    return /\/responses(\/|\?|$)/i.test(endpoint);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function envPositiveInt(name: string, fallback: number): number {
    const v = process.env[name]?.trim();
    if (!v) {
        return fallback;
    }
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parses `Retry-After` (seconds) from response headers when the provider sends it.
 */
function parseRetryAfterMs(
    headers: Record<string, string | number | string[] | undefined>
): number | undefined {
    const raw = headers['retry-after'] ?? headers['Retry-After'];
    if (raw == null) {
        return undefined;
    }
    const token = Array.isArray(raw) ? raw[0] : raw;
    const seconds = parseInt(String(token), 10);
    return Number.isFinite(seconds) && seconds >= 0
        ? seconds * 1000
        : undefined;
}

const DEFAULT_AI_MAX_RETRIES = 8;

async function postAiWithRetry(
    endpoint: string,
    body: Record<string, unknown>,
    requestHeaders: Record<string, string>
): Promise<AxiosResponse> {
    const maxAttempts = envPositiveInt(
        'AI_CODE_PILOT_MAX_RETRIES',
        DEFAULT_AI_MAX_RETRIES
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await axios.post(endpoint, body, {
                headers: requestHeaders,
            });
        } catch (err: unknown) {
            if (!axios.isAxiosError(err) || !err.response) {
                throw err;
            }
            const status = err.response.status;
            const retryable =
                status === 429 ||
                status === 502 ||
                status === 503 ||
                status === 504;
            if (!retryable || attempt === maxAttempts) {
                throw err;
            }
            const headerDelay = parseRetryAfterMs(
                err.response.headers as Record<
                    string,
                    string | number | string[] | undefined
                >
            );
            const exponential = Math.min(
                120_000,
                1000 * Math.pow(2, attempt - 1)
            );
            const jitter = Math.floor(Math.random() * 500);
            const delayMs = (headerDelay ?? exponential) + jitter;
            console.warn(
                `AI HTTP ${status}; backing off ${delayMs}ms ` +
                    `(attempt ${attempt}/${maxAttempts}).`
            );
            await sleep(delayMs);
        }
    }

    throw new Error('postAiWithRetry: unreachable');
}

function buildAiRequestBody(
    endpoint: string,
    model: string,
    content: string
): Record<string, unknown> {
    const temperature =
        typeof aiSettings.ModelTemperature === 'number'
            ? aiSettings.ModelTemperature
            : 0.2;

    if (usesResponsesApi(endpoint)) {
        return {
            model,
            input: [
                {
                    role: 'user',
                    content
                }
            ]
        };
    }

    return {
        model,
        messages: [
            {
                role: 'user',
                content
            }
        ],
        temperature,
        response_format: { type: 'json_object' }
    };
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

    const buildPayload = (diffText: string) => ({
        repository: process.env.BUILD_REPOSITORY_NAME ?? '',
        pullRequestId:
            firstNonEmpty(
                process.env.SYSTEM_PULLREQUEST_PULLREQUESTID,
                process.env.AZURE_DEVOPS_PULL_REQUEST_ID
            ) ?? '',
        agent: agentName,
        instructions: buildPrompt({
            agentName,
            diff: diffText
        })
    });

    const { content, truncated } = fitModelInputContent(
        buildPayload,
        diff
    );

    if (truncated) {
        console.warn(
            `Agent ${agentName}: PR diff was truncated to fit API input limits.`
        );
    }

    let response;
    try {
        response = await postAiWithRetry(
            endpoint,
            buildAiRequestBody(endpoint, model, content),
            {
                'api-key': apiKey,
                'Content-Type': 'application/json',
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

    if (!text) {
        throw new Error(
            'Could not extract text from the AI HTTP response. ' +
            'Use a /responses URL with an `input` body, or a chat/completions URL with `messages`. ' +
            'Set AI_CODE_PILOT_VERBOSE=true to log the raw response.'
        );
    }

    let parsed: AiReviewResult;
    try {
        parsed = parseAiJson<AiReviewResult>(text);
    } catch (error: unknown) {
        const preview = text.length > 400
            ? `${text.slice(0, 400)}…`
            : text;

        if (
            error instanceof Error &&
            error.message.includes('No JSON object found')
        ) {
            throw new Error(
                `${error.message} Model output preview: ${JSON.stringify(preview)}`
            );
        }

        throw error;
    }

    return {
        agentName,
        review: parsed
    };
}
