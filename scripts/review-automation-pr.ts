import axios from 'axios';
import fs from 'fs';
import path from 'path';

import { AUTOMATION_AGENTS } from '../config/agents';
import { runAgentMaybeChunked } from '../services/run-chunked-agent';
import { sendPrAiReviewToTeams } from './send-TeamsNotification';
import { runSummaryAgent } from '../services/run-summary-agent';
import { parseDiffFiles } from '../services/diff-parser';
import { sanitizePrDiffText } from '../services/sanitize-pr-diff';
import { filterDiffForAgent } from '../services/agent-diff-filter';
import { runPostReviewActions } from '../publishComments/run-after-review';
import { dedupeAcrossAgents } from '../services/dedupe-across-agents';

async function reviewPR(): Promise<void> {
    try {
        const repoRoot =
            process.env.BUILD_SOURCESDIRECTORY ??
            path.join(__dirname, '..');

        const diffPath = path.join(repoRoot, 'pr_diff.txt');
        const rawDiff = fs.readFileSync(diffPath, 'utf8');
        const diff = sanitizePrDiffText(rawDiff);
        if (!diff.includes('diff --git')) {
            if (!diff.trim()) {
                console.log(
                    '[AI Code Pilot] No PR diff to review (empty pr_diff.txt) — exiting successfully.'
                );
                return;
            }
            throw new Error(
                'pr_diff.txt is not empty but has no git unified diff (expected "diff --git" lines).'
            );
        }
        const parsedFiles = parseDiffFiles(diff);
        if (parsedFiles.length === 0) {
            console.warn(
                '[AI Code Pilot] pr_diff.txt contains "diff --git" but no files could be parsed. ' +
                'Inline PR comments will be skipped.'
            );
        } else {
            console.log(
                `[AI Code Pilot] Parsed ${parsedFiles.length} file(s) from pr_diff.txt`
            );
        }

        console.log('Running AI agents...');
        const results = [];
        for (const agent of AUTOMATION_AGENTS) {
            const agentDiff = filterDiffForAgent(agent, parsedFiles);
            results.push(await runAgentMaybeChunked(agent, agentDiff));
        }

        const { results: dedupedResults, stats: dedupeStats } =
            dedupeAcrossAgents(results);
        if (dedupeStats.duplicatesRemoved > 0) {
            console.log(
                `[AI Code Pilot] Cross-agent dedupe removed ${dedupeStats.duplicatesRemoved} ` +
                `duplicate finding(s) (${dedupeStats.total} → ${dedupeStats.kept}).`
            );
        } else {
            console.log(
                `[AI Code Pilot] Cross-agent dedupe: ${dedupeStats.total} finding(s), no duplicates.`
            );
        }

        const prIdRaw =
            process.env.SYSTEM_PULLREQUEST_PULLREQUESTID ??
            process.env.AZURE_DEVOPS_PULL_REQUEST_ID ??
            '';
        const parsedPrId = Number.parseInt(prIdRaw, 10);
        const pullRequestId = Number.isFinite(parsedPrId) && parsedPrId > 0
            ? parsedPrId
            : 0;
        const summaryInput = {
            repository: process.env.BUILD_REPOSITORY_NAME ?? '',
            pullRequestId: pullRequestId,
            agentResults: dedupedResults
        };
        const summaryResult = await runSummaryAgent(
            summaryInput,
            dedupedResults
        );

        console.log('Summary agent finished.');

        await runPostReviewActions(
            repoRoot,
            dedupedResults,
            summaryResult.review,
            sendPrAiReviewToTeams,
            { prDiffText: diff }
        );
    } catch (error: unknown) {
        console.error('AI Review Failed');

        if (axios.isAxiosError(error) && error.response) {
            console.error(error.response.data);
        } else if (error instanceof Error) {
            console.error(error.message);
        } else {
            console.error(String(error));
        }

        process.exit(1);
    }
}

void reviewPR();
