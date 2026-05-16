import { AIReviewComment, AzureDevOpsConfig } from '../models/azure-devops';
import { normalizeFilePathForAzure, azureThreadOffsetsFromSourceLine } from './PullRequestDiffService';
import {
    CreateThreadPayload,
    PullRequestThreadClient,
} from './PullRequestThreadClient';

const COMMENT_TYPE_TEXT = 1;
const THREAD_STATUS_ACTIVE = 1;

export class AIReviewCommentService {
    private readonly client: PullRequestThreadClient;

    constructor(config: AzureDevOpsConfig) {
        this.client = new PullRequestThreadClient(config);
    }

    /**
     * Add a single inline comment on the PR diff (right side — PR source / `b/` path).
     */
    public async postInlineComment(
        filePath: string,
        lineNumber: number,
        comment: string,
        sourceLineText?: string
    ): Promise<void> {
        const normalizedPath = normalizeFilePathForAzure(filePath);
        const payload = this.buildThreadPayload(
            normalizedPath,
            lineNumber,
            comment,
            sourceLineText
        );
        await this.client.createThread(payload);
    }

    /**
     * Add a top-level PR discussion comment (not tied to a file line).
     */
    public async postGeneralComment(comment: string): Promise<void> {
        const payload: CreateThreadPayload = {
            comments: [
                {
                    parentCommentId: 0,
                    content: comment,
                    commentType: COMMENT_TYPE_TEXT,
                },
            ],
            status: THREAD_STATUS_ACTIVE,
        };
        await this.client.createThread(payload);
    }

    /**
     * Add multiple AI review inline comments.
     */
    public async postReviewComments(
        reviewComments: AIReviewComment[]
    ): Promise<number> {
        let posted = 0;

        for (const reviewComment of reviewComments) {
            if (!this.validateComment(reviewComment)) {
                continue;
            }

            await this.postInlineComment(
                reviewComment.filePath,
                reviewComment.lineNumber,
                reviewComment.comment,
                reviewComment.sourceLineText
            );
            posted++;
        }

        return posted;
    }

    private buildThreadPayload(
        filePath: string,
        lineNumber: number,
        comment: string,
        sourceLineText?: string
    ): CreateThreadPayload {
        const line = Math.max(1, Math.floor(lineNumber));

        const { startOffset, endOffset } =
            azureThreadOffsetsFromSourceLine(sourceLineText);

        return {
            comments: [
                {
                    parentCommentId: 0,
                    content: comment,
                    commentType: COMMENT_TYPE_TEXT,
                },
            ],
            status: THREAD_STATUS_ACTIVE,
            threadContext: {
                filePath,
                rightFileStart: { line, offset: startOffset },
                rightFileEnd: { line, offset: endOffset },
            },
        };
    }

    private validateComment(reviewComment: AIReviewComment): boolean {
        if (!reviewComment.filePath?.trim()) {
            return false;
        }
        if (
            reviewComment.lineNumber === undefined ||
            reviewComment.lineNumber < 1 ||
            !Number.isFinite(reviewComment.lineNumber)
        ) {
            return false;
        }
        if (!reviewComment.comment?.trim()) {
            return false;
        }
        return true;
    }
}
