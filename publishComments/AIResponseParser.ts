import { AiReviewResult } from '../models/ai-review-result';
import { AIReviewComment } from '../models/azure-devops';
import { AgentResult } from '../services/run-agent';
import { normalizeFilePathForAzure } from './PullRequestDiffService';
import {
    resolveLineAgainstDiff,
    type RightSideLineMaps,
} from './unified-diff-line-map';

function mapSeverity(
    severity: string
): AIReviewComment['severity'] {
    switch (severity.toUpperCase()) {
        case 'CRITICAL':
            return 'CRITICAL';
        case 'HIGH':
            return 'HIGH';
        case 'MEDIUM':
            return 'MEDIUM';
        case 'LOW':
        default:
            return 'LOW';
    }
}

const INLINE_COMMENT_LABEL = '[AI Code Review]';

function fenceLanguageForFile(file: string): string {
    const f = file.toLowerCase();
    if (f.endsWith('.tsx') || f.endsWith('.jsx')) {
        return 'tsx';
    }
    if (f.endsWith('.ts') || f.endsWith('.mts') || f.endsWith('.cts')) {
        return 'ts';
    }
    if (f.endsWith('.cs')) {
        return 'csharp';
    }
    if (f.endsWith('.yml') || f.endsWith('.yaml')) {
        return 'yaml';
    }
    if (f.endsWith('.ps1')) {
        return 'powershell';
    }
    if (f.endsWith('.tf')) {
        return 'hcl';
    }
    return 'text';
}

function formatFindingComment(
    finding: AiReviewResult['findings'][number]
): string {
    const parts = [
        `**${INLINE_COMMENT_LABEL} ${finding.severity}** — ${finding.title}`,
        '',
        `**Category:** ${finding.category}`,
        '',
        finding.explanation,
        '',
        `**Recommendation:** ${finding.recommendation}`,
    ];
    return parts.join('\n');
}

export function parseReviewToComments(
    review: AiReviewResult,
    rightSideMaps?: RightSideLineMaps | null
): AIReviewComment[] {
    if (!review.findings?.length) {
        return [];
    }

    const comments: AIReviewComment[] = [];

    for (const finding of review.findings) {
        if (!finding.file?.trim()) {
            continue;
        }
        const line = finding.line;
        if (line === undefined || line < 1 || !Number.isFinite(line)) {
            continue;
        }

        const resolved = resolveLineAgainstDiff(
            rightSideMaps ?? null,
            finding.file,
            line,
            {
                codeSnippet: finding.codeSnippet,
                explanation: finding.explanation,
            }
        );

        if (resolved.anchorable === false) {
            continue;
        }

        comments.push({
            filePath: normalizeFilePathForAzure(finding.file),
            lineNumber: resolved.lineNumber,
            comment: formatFindingComment(finding),
            severity: mapSeverity(finding.severity),
            ...(resolved.sourceLineText !== undefined
                ? { sourceLineText: resolved.sourceLineText }
                : {}),
        });
    }

    return comments;
}

export function parseAgentResultsToComments(
    agentResults: AgentResult[],
    rightSideMaps?: RightSideLineMaps | null
): AIReviewComment[] {
    return agentResults.flatMap(({ review }) =>
        parseReviewToComments(review, rightSideMaps)
    );
}

export function formatSummaryComment(review: AiReviewResult): string {
    const readiness = review.deploymentReadiness ?? 'UNKNOWN';
    const findingsBlock =
        !review.findings?.length
            ? '_No line-specific findings to attach._'
            : review.findings
                  .slice(0, 15)
                  .map(f => {
                      const loc =
                          f.line != null && f.line > 0
                              ? `\`${f.file}\`:${f.line}`
                              : `\`${f.file}\``;
                      let block = `- **${f.severity}** ${f.title} (${loc})`;
                      const snippet = f.codeSnippet?.trim();
                      if (snippet) {
                          const lang = fenceLanguageForFile(f.file);
                          block += `\n\n\`\`\`${lang}\n${snippet}\n\`\`\``;
                      }
                      return block;
                  })
                  .join('\n\n');

    return [
        '## AI PR Review Summary',
        '',
        review.summary.trim(),
        '',
        `**Deployment readiness:** ${readiness}`,
        '',
        '### Findings overview',
        findingsBlock,
    ].join('\n');
}
