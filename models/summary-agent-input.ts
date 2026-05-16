import { AiReviewResult } from './ai-review-result';

export interface SummaryAgentInput {

    repository: string;

    pullRequestId: number;

    agentResults: SummaryAgentResult[];
}

export interface SummaryAgentResult {

    agentName: string;

    review: AiReviewResult;
}