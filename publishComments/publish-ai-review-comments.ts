import { AiReviewResult } from '../models/ai-review-result';
import { AgentResult } from '../services/run-agent';
import { parseDiffFiles } from '../services/diff-parser';
import { AIReviewCommentService } from './AIReviewCommentService';
import {
    formatSummaryComment,
    parseAgentResultsToComments,
} from './AIResponseParser';
import { loadAzureDevOpsConfig, resolveToolRoot } from './load-azure-config';
import { buildRightSideLineMaps } from './unified-diff-line-map';

const LOG_PREFIX = '[AI Code Pilot][Azure]';

/**
 * @param sourcesRoot - PR app repo root (BUILD_SOURCESDIRECTORY); used for pipeline env context
 */
export async function publishAiReviewComments(
    sourcesRoot: string,
    agentResults: AgentResult[],
    summaryReview: AiReviewResult,
    prDiffText?: string
): Promise<void> {
    const toolRoot = resolveToolRoot();

    const config = loadAzureDevOpsConfig(sourcesRoot, toolRoot);
    if (!config) {
        console.error(`${LOG_PREFIX} PR comments skipped (config incomplete).`);
        return;
    }

    const service = new AIReviewCommentService(config);
    const parsedDiff = prDiffText?.trim().length
        ? parseDiffFiles(prDiffText)
        : [];
    const rightSideMaps =
        parsedDiff.length > 0
            ? buildRightSideLineMaps(parsedDiff)
            : null;

    if (prDiffText?.trim().length && parsedDiff.length === 0) {
        console.warn(
            `${LOG_PREFIX} pr_diff.txt did not parse into any files — inline comments will be skipped. Ensure it is a raw git diff (starts with "diff --git").`
        );
    }

    const inlineComments = parseAgentResultsToComments(
        agentResults,
        rightSideMaps
    );

    await service.postGeneralComment(formatSummaryComment(summaryReview));

    const posted = await service.postReviewComments(inlineComments);
    console.log(
        `${LOG_PREFIX} posted PR #${config.pullRequestId}: summary + ${posted} inline (${inlineComments.length} with file+line).`
    );

    if (inlineComments.length === 0 && (summaryReview.findings?.length ?? 0) > 0) {
        console.warn(
            `${LOG_PREFIX} no inline threads (findings lack line numbers); summary only.`
        );
    }
}
