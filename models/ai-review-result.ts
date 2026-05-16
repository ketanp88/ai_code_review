export interface AiReviewResult {

    agent: string;

    summary: string;

    deploymentReadiness:
        | 'BLOCKED'
        | 'HIGH_RISK'
        | 'MEDIUM_RISK'
        | 'LOW_RISK'
        | 'READY';

    findings: AiFinding[];
}

export interface AiFinding {

    severity:
        | 'CRITICAL'
        | 'HIGH'
        | 'MEDIUM'
        | 'LOW';

    category: string;

    file: string;

    line?: number;

    codeSnippet?: string;

    title: string;

    explanation: string;

    recommendation: string;
}