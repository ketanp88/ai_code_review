import axios from 'axios';
import fs from 'fs';
import path from 'path';

import { DEVELOPMENT_AGENTS, INFRA_AGENTS } from '../config/agents';
import { runAgent } from '../services/run-agent';
import { sendPrAiReviewToTeams } from './send-TeamsNotification';
import { runSummaryAgent } from '../services/run-summary-agent';
import { parseDiffFiles } from '../services/diff-parser';
import {
    filterDiffForAgent,
    hasFilesForAgent
} from '../services/agent-diff-filter';
import { runPostReviewActions } from '../publishComments/run-after-review';

async function reviewPR(): Promise<void> {
    try {
        const repoRoot =
            process.env.BUILD_SOURCESDIRECTORY ??
            path.join(__dirname, '..');

        const diffPath = path.join(repoRoot, 'pr_diff.txt');

        const diff = fs.readFileSync(diffPath, 'utf8');
        const parsedFiles = parseDiffFiles(diff);

        const agents = [
            ...(hasFilesForAgent('devops-agent', parsedFiles)
                ? INFRA_AGENTS
                : []),
            ...DEVELOPMENT_AGENTS
        ];

        console.log(`Running AI agents: ${agents.join(', ')}`);
        const results = await Promise.all(
            agents.map(agent => {
                const agentDiff = filterDiffForAgent(
                    agent,
                    parsedFiles
                );
                return runAgent(agent, agentDiff);
            })
        );

        let pullRequestId = 0;
        if (process.env.BUILD_SOURCEVERSIONMESSAGE) {
            pullRequestId = parseInt(process.env.BUILD_SOURCEVERSIONMESSAGE);
        }
        const summaryInput = {
            repository: process.env.BUILD_REPOSITORY_NAME ?? '',
            pullRequestId: pullRequestId,
            agentResults: results
        };
        const summaryResult = await runSummaryAgent(summaryInput);

        console.log('Summary agent finished.');

        await runPostReviewActions(
            repoRoot,
            results,
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
