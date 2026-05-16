import axios from 'axios';
import https from 'https';
import executionSettings from '../ExecutionSettings.json';
import { AiReviewResult } from '../models/ai-review-result';
import { ExecutionSettingsJson } from '../models/execution-settings';

const execSettings = executionSettings as ExecutionSettingsJson;

/** Stay under typical Incoming Webhook payload limits */
const MAX_REVIEW_CHARS = 24000;

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

function truncateReview(text: string): string {
    if (text.length <= MAX_REVIEW_CHARS) {
        return text;
    }
    return `${text.slice(0, MAX_REVIEW_CHARS)}\n\n…(truncated)`;
}

/**
 * Teams card used to always prefix "# Executive Summary"; model summaries often
 * already start with that heading — avoid showing it twice.
 */
function executiveSummaryBlock(summary: string): string {
    const trimmed = summary.trim();
    if (/^\s*#\s*Executive\s+Summary\b/i.test(trimmed)) {
        return trimmed;
    }
    return `# Executive Summary\n\n${trimmed}`;
}

/**
 * Azure DevOps PR page URL when the job is a PR validation build.
 * Uses `SYSTEM_PULLREQUEST_PULLREQUESTID` (path segment), not only the display number.
 */
function azureDevOpsPullRequestWebUrl(): string | undefined {
    const collectionUri = process.env.SYSTEM_TEAMFOUNDATIONSERVERURI?.trim();
    const project = process.env.SYSTEM_TEAMPROJECT?.trim();
    const repo = process.env.BUILD_REPOSITORY_NAME?.trim();
    const prId = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID?.trim();

    if (
        collectionUri == null ||
        collectionUri === '' ||
        project == null ||
        project === '' ||
        repo == null ||
        repo === '' ||
        prId == null ||
        prId === ''
    ) {
        return undefined;
    }

    const base = collectionUri.replace(/\/+$/, '');
    return `${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${encodeURIComponent(prId)}`;
}

function buildPrReviewMessageCard(
    review: AiReviewResult
): Record<string, unknown> {

    const prNumber =
        process.env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER;

    const repo =
        process.env.BUILD_REPOSITORY_NAME;

    const prUrl =
        azureDevOpsPullRequestWebUrl();

    const activityTitle =
        prNumber
            ? `PR #${prNumber} — AI Review`
            : 'AI PR Review';

    const activitySubtitle =
        repo
            ? `Repository: ${repo}`
            : undefined;

    const findingsMarkdown =
        buildFindingsMarkdown(review);

    const deploymentStatus =
        review.deploymentReadiness ??
        'UNKNOWN';

    const summaryText = `
${executiveSummaryBlock(review.summary)}

# Deployment Readiness

**${deploymentStatus}**

# Findings

${findingsMarkdown}
`;

    const reviewBody =
        prUrl
            ? `[Open pull request](${prUrl})\n\n${summaryText}`
            : summaryText;

    return {

        '@type': 'MessageCard',

        '@context':
            'https://schema.org/extensions',

        themeColor:
            getThemeColor(
                deploymentStatus
            ),

        summary: activityTitle,

        ...(prUrl
            ? {
                  potentialAction: [
                      {
                          '@type': 'OpenUri',
                          name: 'Open PR',
                          targets: [
                              {
                                  os: 'default',
                                  uri: prUrl
                              }
                          ],
                      },
                  ],
              }
            : {}),

        sections: [
            {
                activityTitle,

                ...(activitySubtitle
                    ? { activitySubtitle }
                    : {}),

                markdown: true,

                text: truncateReview(
                    reviewBody
                ),
            },
        ],
    };
}
/**
 * Posts the PR AI review to a Teams channel via Incoming Webhook.
 * No-op when `TeamsWebHooksURL` in ExecutionSettings.json is empty.
 */
export async function sendPrAiReviewToTeams(review: AiReviewResult): Promise<void> {
    const url = (execSettings.TeamsWebHooksURL ?? '').trim() || process.env.TeamsWebHooksURL;
    const body = buildPrReviewMessageCard(review);

    await axios.post(url ?? '', body, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent,
    });

    console.log('PR AI review sent to Teams.');
}

function getThemeColor(
    readiness: string
): string {

    switch (readiness) {

        case 'BLOCKED':
            return 'FF0000';

        case 'HIGH_RISK':
            return 'FF4500';

        case 'MEDIUM_RISK':
            return 'FFA500';

        case 'LOW_RISK':
            return '0078D7';

        case 'READY':
        case 'READY_FOR_DEPLOYMENT':
            return '28A745';

        default:
            return '0078D7';
    }
}

function buildFindingsMarkdown(
    review: AiReviewResult
): string {

    if (
        !review.findings ||
        review.findings.length === 0
    ) {
        return 'No significant findings.';
    }

    return review.findings
        .slice(0, 10)
        .map(finding => {

            return `
### ${finding.severity} — ${finding.title}

**Category:** ${finding.category}  
**File:** ${finding.file}

${finding.explanation}

**Recommendation:**  
${finding.recommendation}
`;
        })
        .join('\n\n');
}