import { PullRequestThreadClient } from '../publishComments/PullRequestThreadClient';
import { AIReviewCommentService } from '../publishComments/AIReviewCommentService';
import {
    loadAzureDevOpsConfig,
    resolveToolRoot,
} from '../publishComments/load-azure-config';

function parseArgs(argv: string[]): { generalOnly: boolean } {
    return {
        generalOnly: argv.includes('--general'),
    };
}

async function main(): Promise<void> {
    const toolRoot = resolveToolRoot();
    const sourcesRoot =
        process.env.BUILD_SOURCESDIRECTORY?.trim() || toolRoot;

    const config = loadAzureDevOpsConfig(sourcesRoot, toolRoot);
    if (!config) {
        console.error(
            'Config incomplete. Set AZURE_DEVOPS_PAT in ExecutionSettings.json and Azure DevOps env (SYSTEM_TEAMPROJECT, BUILD_REPOSITORY_*, SYSTEM_PULLREQUEST_PULLREQUESTID, etc.), or run on an Azure Pipelines PR job.'
        );
        process.exit(1);
    }

    console.log(
        `Using auth: ${config.authScheme} (${config.authScheme === 'Basic' ? 'matches Postman blank user + PAT' : 'pipeline OAuth'})`
    );
    console.log(`Target PR #${config.pullRequestId}`);

    const client = new PullRequestThreadClient(config);
    console.log(`POST ${client.getThreadsUrl()}`);

    const service = new AIReviewCommentService(config);
    const text =
        process.env.VERIFY_COMMENT_TEXT?.trim() ||
        'AI Code Pilot verify-azure-pr-comment.ts — inline test (same API as Postman).';

    const { generalOnly } = parseArgs(process.argv.slice(2));

    if (generalOnly) {
        await service.postGeneralComment(text);
        console.log('OK: general PR thread created (no file anchor).');
        return;
    }

    const filePath = process.env.VERIFY_FILE_PATH?.trim() || '/pages/UI/taskspage.pom.ts';
    const line = parseInt(process.env.VERIFY_LINE ?? '62', 10);
    if (!Number.isFinite(line) || line < 1) {
        console.error('VERIFY_LINE must be a positive integer.');
        process.exit(1);
    }

    await service.postInlineComment(filePath, line, text);
    console.log(`OK: inline thread created on ${filePath}:${line}`);
}

void main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
