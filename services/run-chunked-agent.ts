import { buildPrompt } from './prompt-builder';
import { isChunkedReviewAgent } from '../config/chunked-agents';
import { parseDiffFiles } from './diff-parser';
import {
    chunkDiffByFiles,
    refineChunksToPayloadLimit,
    withChunkHeaders
} from './diff-chunker';
import {
    fitModelInputContent,
    maxDiffCharsThatFit
} from './fit-model-input';
import { mergeAgentReviews } from './merge-agent-reviews';
import { AgentResult, runAgent } from './run-agent';

/** Leave headroom — real diffs expand more than a uniform `x` probe in JSON. */
const CHUNK_SIZE_FACTOR = 0.85;

function buildPayloadForAgent(agentName: string) {
    return (diffText: string) => ({
        repository: process.env.BUILD_REPOSITORY_NAME ?? '',
        pullRequestId:
            process.env.SYSTEM_PULLREQUEST_PULLREQUESTID ??
            process.env.AZURE_DEVOPS_PULL_REQUEST_ID ??
            '',
        agent: agentName,
        instructions: buildPrompt({
            agentName,
            diff: diffText
        })
    });
}

function diffNeedsChunking(
    agentName: string,
    diff: string
): boolean {
    if (!diff.trim() || !isChunkedReviewAgent(agentName)) {
        return false;
    }

    const buildPayload = buildPayloadForAgent(agentName);
    const fitted = fitModelInputContent(buildPayload, diff);
    return fitted.truncated;
}

/**
 * Runs an agent once, or splits the diff into file-based chunks and merges findings
 * when the full diff does not fit in one request.
 */
export async function runAgentMaybeChunked(
    agentName: string,
    diff: string
): Promise<AgentResult> {
    if (!diffNeedsChunking(agentName, diff)) {
        return runAgent(agentName, diff);
    }

    const buildPayload = buildPayloadForAgent(agentName);
    const maxChars = Math.floor(
        maxDiffCharsThatFit(buildPayload) * CHUNK_SIZE_FACTOR
    );

    if (maxChars <= 0) {
        throw new Error(
            `Agent ${agentName}: prompts alone exceed the model input limit. ` +
            `Increase MaxModelInputBytes in AISettings.json.`
        );
    }

    const files = parseDiffFiles(diff);
    let rawChunks = refineChunksToPayloadLimit(
        buildPayload,
        chunkDiffByFiles(files, maxChars)
    );
    let chunks = withChunkHeaders(rawChunks, agentName);
    chunks = refineChunksToPayloadLimit(buildPayload, chunks);

    console.log(
        `Agent ${agentName}: diff split into ${chunks.length} chunks ` +
        `(~${maxChars} chars each, ${diff.length} chars total) — full PR will be reviewed.`
    );

    const chunkReviews = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunkDiff = chunks[i];
        console.log(
            `Agent ${agentName}: running chunk ${i + 1}/${chunks.length} ` +
            `(${chunkDiff.length} chars)`
        );
        const result = await runAgent(agentName, chunkDiff);
        chunkReviews.push(result.review);
    }

    return {
        agentName,
        review: mergeAgentReviews(agentName, chunkReviews)
    };
}
