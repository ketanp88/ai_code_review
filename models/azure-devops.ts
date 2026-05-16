export interface AIReviewComment {
    filePath: string;
    lineNumber: number;
    comment: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    sourceLineText?: string;
}

export type AzureDevOpsAuthScheme = 'Bearer' | 'Basic';

export interface AzureDevOpsConfig {
    organizationUrl: string;
    project: string;
    repositoryId: string;
    pullRequestId: number;
    accessToken: string;
    authScheme: AzureDevOpsAuthScheme;
}
