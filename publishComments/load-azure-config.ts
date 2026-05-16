import fs from 'fs';
import path from 'path';

import {
    AzureDevOpsAuthScheme,
    AzureDevOpsConfig,
} from '../models/azure-devops';
import { ExecutionSettingsJson } from '../models/execution-settings';

function trimOrUndefined(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed === '' ? undefined : trimmed;
}

function isVerbose(): boolean {
    return trimOrUndefined(process.env.AI_CODE_PILOT_VERBOSE)?.toLowerCase() === 'true';
}

/**
 * JSON/config sometimes stores URL-encoded project names
 */
function normalizePercentEncodedSegment(
    value: string | undefined
): string | undefined {
    const t = trimOrUndefined(value);
    if (!t) {
        return undefined;
    }
    if (/%[0-9A-Fa-f]{2}/.test(t)) {
        try {
            return decodeURIComponent(t);
        } catch {
            return t;
        }
    }
    return t;
}

function parsePullRequestId(
    value: string | number | undefined
): number | undefined {
    if (value === undefined || value === '') {
        return undefined;
    }
    const parsed =
        typeof value === 'number' ? value : parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function collectionUriAsOrganizationUrl(
    collectionUri: string
): string | undefined {
    const trimmed = collectionUri.trim().replace(/\/+$/, '');
    if (!trimmed) {
        return undefined;
    }
    try {
        new URL(trimmed);
        return trimmed;
    } catch {
        return undefined;
    }
}

function organisationFromCollectionUri(uri: string): string | undefined {
    try {
        const url = new URL(uri);
        const segment = url.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
        return segment || undefined;
    } catch {
        return undefined;
    }
}

function organizationUrlFromName(org: string): string {
    const trimmed = org.trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    const name = trimmed.replace(/^dev\.azure\.com\//i, '');
    return `https://dev.azure.com/${encodeURIComponent(name)}`;
}

/**
 * Root of the AI_Code_Pilot tool (where ExecutionSettings.json lives), not the PR app repo.
 */
export function resolveToolRoot(): string {
    const fromEnv = trimOrUndefined(process.env.AI_CODE_PILOT_ROOT);
    if (fromEnv) {
        return fromEnv;
    }
    return path.join(__dirname, '..');
}

/**
 * True when running on an Azure Pipelines agent (diagnostics / callers).
 */
export function isAzurePipelinesAgent(): boolean {
    return Boolean(
        trimOrUndefined(process.env.SYSTEM_TEAMPROJECT) ||
            trimOrUndefined(process.env.BUILD_BUILDID)
    );
}

/**
 * Rejects unsubstituted Azure DevOps macro strings in JSON (e.g. after a missed FileTransform).
 */
function executionSettingsSecret(value: string | undefined): string | undefined {
    const t = trimOrUndefined(value);
    if (t && /^\$\([A-Za-z0-9_.]+\)$/.test(t)) {
        console.warn(
            `[AI Code Pilot][Azure] ExecutionSettings.json AZURE_DEVOPS_PAT looks unsubstituted (${t}). Check FileTransform@2 / variable mapping.`
        );
        return undefined;
    }
    return t;
}

function loadExecutionSettingsFile(
    searchRoots: string[],
    logOnFailure: boolean
): { execConfig: ExecutionSettingsJson; loadedFrom?: string } {
    const explicitPath =
        trimOrUndefined(process.env.EXECUTION_SETTINGS_PATH) ??
        trimOrUndefined(process.env.AZURE_DETAILS_PATH);
    if (explicitPath && fs.existsSync(explicitPath)) {
        return {
            execConfig: JSON.parse(
                fs.readFileSync(explicitPath, 'utf8')
            ) as ExecutionSettingsJson,
            loadedFrom: explicitPath,
        };
    }

    for (const root of searchRoots) {
        const settingsPath = path.join(root, 'ExecutionSettings.json');
        if (fs.existsSync(settingsPath)) {
            return {
                execConfig: JSON.parse(
                    fs.readFileSync(settingsPath, 'utf8')
                ) as ExecutionSettingsJson,
                loadedFrom: settingsPath,
            };
        }
    }

    if (logOnFailure) {
        console.warn(
            `[AI Code Pilot][Azure] ExecutionSettings.json not found under tool or app root (set EXECUTION_SETTINGS_PATH).`
        );
    }

    return { execConfig: {} };
}

function resolveAzureDevOpsConfig(
    sourcesRoot: string,
    toolRoot: string,
    logOnFailure: boolean
): { config: AzureDevOpsConfig | null; loadedFrom?: string } {
    const searchRoots = [toolRoot, sourcesRoot];
    const { execConfig, loadedFrom } = loadExecutionSettingsFile(
        searchRoots,
        logOnFailure
    );

    if (loadedFrom && logOnFailure && isVerbose()) {
        console.log(
            `[AI Code Pilot][Azure] loaded ExecutionSettings.json from ${loadedFrom}`
        );
    }

    const collectionUri =
        trimOrUndefined(process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI) ??
        trimOrUndefined(process.env.SYSTEM_COLLECTIONURI);

    // Org / project / repo / PR: Azure Pipelines (and explicit ADO) env only.
    const organisation =
        trimOrUndefined(process.env.AZURE_DEVOPS_ORGANISATION) ??
        (collectionUri
            ? organisationFromCollectionUri(collectionUri)
            : undefined);

    const project =
        normalizePercentEncodedSegment(process.env.SYSTEM_TEAMPROJECT) ??
        normalizePercentEncodedSegment(process.env.AZURE_DEVOPS_PROJECT);

    const repositoryId =
        trimOrUndefined(process.env.BUILD_REPOSITORY_ID) ??
        trimOrUndefined(process.env.AZURE_DEVOPS_REPOSITORY_ID) ??
        trimOrUndefined(process.env.BUILD_REPOSITORY_NAME);

    const pullRequestId =
        parsePullRequestId(process.env.AZURE_DEVOPS_PULL_REQUEST_ID) ??
        parsePullRequestId(process.env.SYSTEM_PULLREQUEST_PULLREQUESTID);

    const pipelineToken = trimOrUndefined(process.env.SYSTEM_ACCESSTOKEN);
    const patFromFile = executionSettingsSecret(execConfig.AZURE_DEVOPS_PAT);
    const allowBuildTokenOnly =
        trimOrUndefined(
            process.env.AI_CODE_PILOT_ALLOW_BUILD_TOKEN
        )?.toLowerCase() === 'true';

    // PAT from ExecutionSettings.json AZURE_DEVOPS_PAT only (e.g. FileTransform@2). Optional Bearer build token.
    const accessToken =
        patFromFile ?? (allowBuildTokenOnly ? pipelineToken : undefined);
    let authScheme: AzureDevOpsAuthScheme = 'Basic';
    let authSource = 'unknown';
    if (accessToken && patFromFile && accessToken === patFromFile) {
        authSource = 'ExecutionSettings.json AZURE_DEVOPS_PAT';
    } else if (accessToken && pipelineToken && accessToken === pipelineToken) {
        authScheme = 'Bearer';
        authSource = 'SYSTEM_ACCESSTOKEN';
    }

    const organizationUrl =
        trimOrUndefined(process.env.AZURE_DEVOPS_ORGANIZATION_URL) ??
        (collectionUri
            ? collectionUriAsOrganizationUrl(collectionUri)
            : undefined) ??
        (organisation ? organizationUrlFromName(organisation) : undefined);

    const missing: string[] = [];
    if (!organizationUrl) {
        missing.push(
            'organizationUrl (SYSTEM_TEAMFOUNDATIONCOLLECTIONURI / AZURE_DEVOPS_ORGANIZATION_URL / AZURE_DEVOPS_ORGANISATION)'
        );
    }
    if (!project) {
        missing.push(
            'project (SYSTEM_TEAMPROJECT or AZURE_DEVOPS_PROJECT)'
        );
    }
    if (!repositoryId) {
        missing.push(
            'repositoryId (BUILD_REPOSITORY_ID, AZURE_DEVOPS_REPOSITORY_ID, or BUILD_REPOSITORY_NAME)'
        );
    }
    if (pullRequestId === undefined) {
        missing.push(
            'pullRequestId (SYSTEM_PULLREQUEST_PULLREQUESTID or AZURE_DEVOPS_PULL_REQUEST_ID)'
        );
    }
    if (!accessToken) {
        if (pipelineToken && !patFromFile && !allowBuildTokenOnly) {
            missing.push(
                'accessToken — set AZURE_DEVOPS_PAT in ExecutionSettings.json (e.g. FileTransform from a secret variable). System.AccessToken is ignored unless AI_CODE_PILOT_ALLOW_BUILD_TOKEN=true.'
            );
        } else {
            missing.push('accessToken (see hints below)');
        }
    }

    if (missing.length > 0) {
        if (logOnFailure) {
            console.error(
                `[AI Code Pilot][Azure] PR comments skipped: ${missing.join('; ')}.`
            );
            if (!accessToken) {
                console.error(
                    '[AI Code Pilot][Azure] Provide AZURE_DEVOPS_PAT in ExecutionSettings.json (pipeline: FileTransform@2 on that file). For build identity only, set AI_CODE_PILOT_ALLOW_BUILD_TOKEN=true and grant Pull Request Contribute.'
                );
            }
        }
        return { config: null, loadedFrom };
    }

    if (logOnFailure && isVerbose()) {
        console.log(
            `[AI Code Pilot][Azure] auth: ${authScheme} via ${authSource}`
        );
    }

    return {
        config: {
            organizationUrl: organizationUrl!.replace(/\/+$/, ''),
            project: project!,
            repositoryId: repositoryId!,
            pullRequestId: pullRequestId!,
            accessToken: accessToken!,
            authScheme,
        },
        loadedFrom,
    };
}

export function loadAzureDevOpsConfig(
    sourcesRoot: string,
    toolRoot?: string
): AzureDevOpsConfig | null {
    const tool = toolRoot ?? resolveToolRoot();
    return resolveAzureDevOpsConfig(sourcesRoot, tool, true).config;
}
