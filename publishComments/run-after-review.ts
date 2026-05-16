import axios from 'axios';

import { AiReviewResult } from '../models/ai-review-result';
import { AgentResult } from '../services/run-agent';
import { publishAiReviewComments } from './publish-ai-review-comments';

const LOG_PREFIX = '[AI Code Pilot]';

/**
 * Teams + Azure publish after agents complete. Used by all review-* scripts.
 */
export async function runPostReviewActions(
    repoRoot: string,
    agentResults: AgentResult[],
    summaryReview: AiReviewResult,
    sendTeams: (review: AiReviewResult) => Promise<void>,
    options?: { prDiffText?: string }
): Promise<void> {
    try {
        await sendTeams(summaryReview);
    } catch (teamsError: unknown) {
        console.error(`${LOG_PREFIX} Teams notification failed (review completed).`);
        if (axios.isAxiosError(teamsError) && teamsError.response) {
            console.error(teamsError.response.data);
        } else if (teamsError instanceof Error) {
            console.error(teamsError.message);
        } else {
            console.error(String(teamsError));
        }
    }

    try {
        await publishAiReviewComments(
            repoRoot,
            agentResults,
            summaryReview,
            options?.prDiffText
        );
    } catch (azureError: unknown) {
        console.error(`${LOG_PREFIX} Azure DevOps PR comments failed (review completed).`);
        if (axios.isAxiosError(azureError) && azureError.response) {
            console.error(azureError.response.status, azureError.response.data);
        } else if (azureError instanceof Error) {
            console.error(azureError.message);
        } else {
            console.error(String(azureError));
        }
    }
}
