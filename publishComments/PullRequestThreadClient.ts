import axios, { AxiosInstance, AxiosError } from 'axios';

import { AzureDevOpsConfig } from '../models/azure-devops';

const API_VERSION = '7.1';

export interface ThreadCommentPayload {
    parentCommentId: number;
    content: string;
    commentType: number;
}

export interface ThreadContextPayload {
    filePath: string;
    rightFileStart: { line: number; offset: number };
    rightFileEnd: { line: number; offset: number };
}

export interface CreateThreadPayload {
    comments: ThreadCommentPayload[];
    status: number;
    threadContext?: ThreadContextPayload;
}

function buildAuthHeader(config: AzureDevOpsConfig): string {
    if (config.authScheme === 'Bearer') {
        return `Bearer ${config.accessToken}`;
    }
    const encoded = Buffer.from(`:${config.accessToken}`).toString('base64');
    return `Basic ${encoded}`;
}

function enrichApiError(error: unknown, requestUrl: string): Error {
    if (!axios.isAxiosError(error)) {
        return error instanceof Error ? error : new Error(String(error));
    }

    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const body = axiosError.response?.data;
    const detail =
        typeof body === 'object'
            ? JSON.stringify(body)
            : String(body ?? axiosError.message);

    let hint = '';
    if (status === 401) {
        hint =
            ' Check AZURE_DEVOPS_PAT in ExecutionSettings.json, or Bearer + System.AccessToken when AI_CODE_PILOT_ALLOW_BUILD_TOKEN=true.';
    } else if (status === 403) {
        hint =
            ' If the identity is "Build\\...", the job used System.AccessToken — set AZURE_DEVOPS_PAT in ExecutionSettings.json via FileTransform, or grant "Contribute to pull requests" for the build identity, or use AI_CODE_PILOT_ALLOW_BUILD_TOKEN=true with a PAT-capable token.';
    } else if (status === 404) {
        hint =
            ' Verify organization URL includes the org segment (https://dev.azure.com/{org}), repository id/name, and pull request id.';
    }

    return new Error(
        `Azure DevOps API ${status ?? 'error'} for ${requestUrl}: ${detail}.${hint}`
    );
}

export class PullRequestThreadClient {
    private readonly http: AxiosInstance;
    private readonly threadsBaseUrl: string;

    constructor(private readonly config: AzureDevOpsConfig) {
        const { organizationUrl, project, repositoryId, pullRequestId } =
            config;

        const encodedProject = encodeURIComponent(project);
        this.threadsBaseUrl =
            `${organizationUrl}/${encodedProject}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${pullRequestId}/threads`;

        this.http = axios.create({
            headers: {
                Authorization: buildAuthHeader(config),
                'Content-Type': 'application/json',
            },
        });
    }

    public getThreadsUrl(): string {
        return `${this.threadsBaseUrl}?api-version=${API_VERSION}`;
    }

    public async createThread(
        payload: CreateThreadPayload
    ): Promise<unknown> {
        const url = this.getThreadsUrl();
        try {
            const response = await this.http.post(url, payload);
            return response.data;
        } catch (error: unknown) {
            throw enrichApiError(error, url);
        }
    }
}
