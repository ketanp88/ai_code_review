import { AiReviewResult } from '../models/ai-review-result';

const READINESS_RANK: Record<AiReviewResult['deploymentReadiness'], number> = {
    BLOCKED: 5,
    HIGH_RISK: 4,
    MEDIUM_RISK: 3,
    LOW_RISK: 2,
    READY: 1
};

function worstReadiness(
    reviews: AiReviewResult[]
): AiReviewResult['deploymentReadiness'] {
    let worst: AiReviewResult['deploymentReadiness'] = 'READY';
    let rank = READINESS_RANK.READY;

    for (const review of reviews) {
        const r = review.deploymentReadiness ?? 'READY';
        const score = READINESS_RANK[r] ?? 0;
        if (score > rank) {
            rank = score;
            worst = r;
        }
    }

    return worst;
}

function dedupeKey(finding: AiReviewResult['findings'][0]): string {
    return [
        finding.file,
        finding.line ?? '',
        finding.severity,
        finding.title
    ].join('|');
}

/**
 * Combines multiple chunk reviews from the same agent into one result.
 */
export function mergeAgentReviews(
    agentName: string,
    reviews: AiReviewResult[]
): AiReviewResult {
    if (reviews.length === 0) {
        return {
            agent: agentName,
            summary: 'No review output was returned.',
            deploymentReadiness: 'READY',
            findings: []
        };
    }

    if (reviews.length === 1) {
        return { ...reviews[0], agent: agentName };
    }

    const seen = new Set<string>();
    const findings: AiReviewResult['findings'] = [];

    for (const review of reviews) {
        for (const finding of review.findings ?? []) {
            const key = dedupeKey(finding);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            findings.push(finding);
        }
    }

    const summaryParts = reviews
        .map((r, i) => {
            const text = r.summary?.trim();
            if (!text) {
                return '';
            }
            return reviews.length > 1
                ? `### Chunk ${i + 1} of ${reviews.length}\n${text}`
                : text;
        })
        .filter(Boolean);

    return {
        agent: agentName,
        summary:
            summaryParts.join('\n\n') ||
            `Merged review from ${reviews.length} diff chunks.`,
        deploymentReadiness: worstReadiness(reviews),
        findings
    };
}
