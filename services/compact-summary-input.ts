import { SummaryAgentInput } from '../models/summary-agent-input';

const MAX_SUMMARY_CHARS = 12_000;
const MAX_FINDINGS_PER_AGENT = 40;
const MAX_SNIPPET_CHARS = 400;
const MAX_TEXT_CHARS = 1_200;

function trimText(value: string | undefined, max: number): string {
    if (!value) {
        return '';
    }
    return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * Shrinks agent outputs before the summary agent so combined JSON stays
 * within model input limits on large PRs.
 */
export function compactSummaryInput(
    input: SummaryAgentInput
): SummaryAgentInput {
    return {
        repository: input.repository,
        pullRequestId: input.pullRequestId,
        agentResults: input.agentResults.map(({ agentName, review }) => ({
            agentName,
            review: {
                ...review,
                summary: trimText(review.summary, MAX_SUMMARY_CHARS),
                findings: (review.findings ?? [])
                    .slice(0, MAX_FINDINGS_PER_AGENT)
                    .map(f => ({
                        ...f,
                        codeSnippet: trimText(f.codeSnippet, MAX_SNIPPET_CHARS),
                        explanation: trimText(f.explanation, MAX_TEXT_CHARS),
                        recommendation: trimText(
                            f.recommendation,
                            MAX_TEXT_CHARS
                        ),
                        title: trimText(f.title, 300)
                    }))
            }
        }))
    };
}
