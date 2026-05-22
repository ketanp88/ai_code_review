import { AiFinding } from '../models/ai-review-result';
import { AgentResult } from './run-agent';

const SEVERITY_RANK: Record<AiFinding['severity'], number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
};

const TITLE_SIGNATURE_LENGTH = 60;

function normalizeTitleSignature(title: string | undefined): string {
    if (!title) {
        return '';
    }
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .slice(0, TITLE_SIGNATURE_LENGTH);
}

function findingDedupeKey(finding: AiFinding): string {
    const file = (finding.file ?? '').trim().toLowerCase();
    const line = finding.line ?? 0;
    const titleSig = normalizeTitleSignature(finding.title);
    return `${file}|${line}|${titleSig}`;
}

function severityRank(finding: AiFinding): number {
    return SEVERITY_RANK[finding.severity] ?? 0;
}

interface WinnerPosition {
    agentIdx: number;
    findingIdx: number;
    severity: number;
}

/**
 * Cross-agent dedupe. When multiple agents report the same `(file, line, title)`
 * the most-severe instance wins and the others are dropped. Within-agent
 * duplicates (already handled by mergeAgentReviews) pass through unchanged
 * because they have unique (agentIdx, findingIdx) tuples.
 *
 * The key is intentionally severity-agnostic: two agents disagreeing on
 * severity are still the same finding. Title is normalized to alphanumeric
 * tokens before signing so wording differences don't defeat dedupe.
 */
export interface DedupeStats {
    /** Total findings across all agents before dedupe. */
    total: number;
    /** Distinct findings after dedupe. */
    kept: number;
    /** How many findings were dropped as duplicates of another agent's finding. */
    duplicatesRemoved: number;
}

export interface DedupeResult {
    results: AgentResult[];
    stats: DedupeStats;
}

export function dedupeAcrossAgents(results: AgentResult[]): DedupeResult {
    const winners = new Map<string, WinnerPosition>();
    let total = 0;

    results.forEach(({ review }, agentIdx) => {
        const findings = review.findings ?? [];
        for (let findingIdx = 0; findingIdx < findings.length; findingIdx++) {
            total++;
            const key = findingDedupeKey(findings[findingIdx]);
            const rank = severityRank(findings[findingIdx]);
            const existing = winners.get(key);
            if (!existing || rank > existing.severity) {
                winners.set(key, { agentIdx, findingIdx, severity: rank });
            }
        }
    });

    const dedupedResults: AgentResult[] = results.map(
        ({ agentName, review }, agentIdx) => ({
            agentName,
            review: {
                ...review,
                findings: (review.findings ?? []).filter(
                    (finding, findingIdx) => {
                        const key = findingDedupeKey(finding);
                        const winner = winners.get(key);
                        if (!winner) {
                            return true;
                        }
                        return (
                            winner.agentIdx === agentIdx &&
                            winner.findingIdx === findingIdx
                        );
                    }
                )
            }
        })
    );

    const kept = dedupedResults.reduce(
        (n, r) => n + (r.review.findings?.length ?? 0),
        0
    );

    return {
        results: dedupedResults,
        stats: {
            total,
            kept,
            duplicatesRemoved: total - kept
        }
    };
}
