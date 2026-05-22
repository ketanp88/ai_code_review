export const AGENT_FILE_RULES = {

    'security-agent': [
        '*'
    ],

    'architecture-agent': [
        '*'
    ],

    'performance-agent': [
        '.cs',
        '.sql',
        '.ts',
        '.tsx',
        '.js',
        '.cshtml'
    ],

    // .NET / ASP.NET Core coverage.
    // - Source files: .cs, .cshtml (Razor views), .razor (Blazor)
    // - Project / solution: .csproj, .sln
    // - Legacy framework configs (web.config, app.config, packages.config) via .config
    // - ASP.NET Core configs: appsettings*.json and launchSettings.json matched
    //   as basename substrings (the filter uses .includes() for non-dot rules)
    'dotNet-agent': [
        '.cs',
        '.cshtml',
        '.razor',
        '.csproj',
        '.sln',
        '.config',
        'appsettings',
        'launchSettings.json'
    ],

    // Single unified UI reviewer (formerly react-agent + frontend-agent).
    // Covers React component logic, hooks, rendering, accessibility, styling,
    // assets, and browser runtime concerns. See prompts/agents/ui-agent.md.
    'ui-agent': [
        '.tsx',
        '.jsx',
        '.css',
        '.scss',
        '.sass',
        '.html',
        '.cshtml',
        '.js',
        '.ts',
        '.svg'
    ],

    // automation-agent runs from scripts/review-automation-pr.ts only,
    // against a dedicated automation/test repository. Every TS/JS file
    // in that repo is in scope (page objects, fixtures, helpers, specs).
    // `.feature` is listed separately because Cucumber files are not TS/JS.
    'automation-agent': [
        '.ts',
        '.js',
        '.feature'
    ],

    'devops-agent': [
        '.yml',
        '.yaml',
        'Dockerfile',
        '.ps1',
        '.sh',
        '.tf',
        '.bicep'
    ]
};
