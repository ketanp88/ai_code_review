import { AiReviewResult } from '../models/ai-review-result';
import { AgentResult } from '../services/run-agent';
import { parseDiffFiles } from '../services/diff-parser';
import { sanitizePrDiffText } from '../services/sanitize-pr-diff';
import { AIReviewCommentService } from './AIReviewCommentService';
import {
    collectInlineComments,
    formatSummaryComment,
} from './AIResponseParser';
import { loadAzureDevOpsConfig, resolveToolRoot } from './load-azure-config';
import {
    buildRightSideLineMaps,
    resolveLineAgainstDiff,
} from './unified-diff-line-map';

const LOG_PREFIX = '[AI Code Pilot][Azure]';

function countAnchorableFindings(
    reviews: AiReviewResult[],
    rightSideMaps: ReturnType<typeof buildRightSideLineMaps> | null
): { total: number; withFileAndLine: number; anchorable: number } {
    let total = 0;
    let withFileAndLine = 0;
    let anchorable = 0;

    for (const review of reviews) {
        for (const finding of review.findings ?? []) {
            total++;
            if (
                !finding.file?.trim() ||
                finding.line === undefined ||
                finding.line < 1 ||
                !Number.isFinite(finding.line)
            ) {
                continue;
            }
            withFileAndLine++;
            const resolved = resolveLineAgainstDiff(
                rightSideMaps,
                finding.file,
                finding.line,
                {
                    codeSnippet: finding.codeSnippet,
                    title: finding.title,
                    explanation: finding.explanation,
                    recommendation: finding.recommendation,
                }
            );
            if (resolved.anchorable) {
                anchorable++;
            }
        }
    }

    return { total, withFileAndLine, anchorable };
}

function logInlineSkipDiagnostics(
    agentResults: AgentResult[],
    summaryReview: AiReviewResult,
    parsedDiffFileCount: number,
    rightSideMapCount: number,
    rightSideMaps: ReturnType<typeof buildRightSideLineMaps> | null
): void {
    const agentReviews = agentResults.map(r => r.review);
    const agentMetrics = countAnchorableFindings(agentReviews, rightSideMaps);
    const summaryMetrics = countAnchorableFindings(
        [summaryReview],
        rightSideMaps
    );

    console.log(
        `${LOG_PREFIX} diagnostics: pr_diffFiles=${parsedDiffFileCount}, ` +
            `diffLineMaps=${rightSideMapCount}, ` +
            `agentFindings=${agentMetrics.total} (file+line=${agentMetrics.withFileAndLine}, anchorable=${agentMetrics.anchorable}), ` +
            `summaryFindings=${summaryMetrics.total} (file+line=${summaryMetrics.withFileAndLine}, anchorable=${summaryMetrics.anchorable})`
    );

    if (agentMetrics.withFileAndLine > 0 && agentMetrics.anchorable === 0) {
        console.warn(
            `${LOG_PREFIX} agents returned file+line but none matched pr_diff.txt paths/lines — check file paths match the diff (b/ side).`
        );
    }

    if (
        agentMetrics.anchorable === 0 &&
        summaryMetrics.anchorable > 0
    ) {
        console.log(
            `${LOG_PREFIX} summary agent has anchorable findings; using summary for inline when agents do not.`
        );
    }
}

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
    const sanitizedDiff = prDiffText?.trim().length
        ? sanitizePrDiffText(prDiffText)
        : '';
    const parsedDiff = sanitizedDiff.length
        ? parseDiffFiles(sanitizedDiff)
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

    const inlineComments = collectInlineComments(
        agentResults,
        summaryReview,
        rightSideMaps
    );

    if (inlineComments.length === 0) {
        logInlineSkipDiagnostics(
            agentResults,
            summaryReview,
            parsedDiff.length,
            rightSideMaps?.size ?? 0,
            rightSideMaps
        );
        console.log(
            `${LOG_PREFIX} no inline comments for PR #${config.pullRequestId} — skipping Azure summary and threads.`
        );
        if ((summaryReview.findings?.length ?? 0) > 0) {
            console.warn(
                `${LOG_PREFIX} findings were not anchored to the diff (missing or invalid file/line); Teams notification may still have been sent.`
            );
        }
        return;
    }

    const posted = await service.postReviewComments(inlineComments);

    if (posted > 0) {
        await service.postGeneralComment(formatSummaryComment(summaryReview));
        console.log(
            `${LOG_PREFIX} posted PR #${config.pullRequestId}: summary + ${posted} inline (${inlineComments.length} candidate(s)).`
        );
    } else {
        console.warn(
            `${LOG_PREFIX} inline comments could not be posted — summary not added to PR #${config.pullRequestId}.`
        );
    }
}
