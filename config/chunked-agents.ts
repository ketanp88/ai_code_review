import {
    AUTOMATION_AGENTS,
    DEVELOPMENT_AGENTS,
    INFRA_AGENTS
} from './agents';

/** Agents that split oversized diffs into multiple API calls instead of truncating. */
export const CHUNKED_REVIEW_AGENTS = [
    ...DEVELOPMENT_AGENTS,
    ...INFRA_AGENTS,
    ...AUTOMATION_AGENTS
] as const;

export type ChunkedReviewAgent = (typeof CHUNKED_REVIEW_AGENTS)[number];

export function isChunkedReviewAgent(agentName: string): boolean {
    const fromEnv = process.env.AI_CODE_PILOT_CHUNKED_AGENTS?.trim();
    if (fromEnv) {
        const list = fromEnv.split(',').map(s => s.trim()).filter(Boolean);
        return list.includes(agentName);
    }
    return (CHUNKED_REVIEW_AGENTS as readonly string[]).includes(agentName);
}
