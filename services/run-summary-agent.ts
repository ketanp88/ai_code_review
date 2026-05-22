import { AgentResult, runAgent } from './run-agent';
import { compactSummaryInput } from './compact-summary-input';
import { SummaryAgentInput } from '../models/summary-agent-input';

export async function runSummaryAgent(
    input: SummaryAgentInput,
    agentResults: AgentResult[]
) {
    const compacted = compactSummaryInput({
        repository: input.repository,
        pullRequestId: input.pullRequestId,
        agentResults: agentResults.map(r => ({
            agentName: r.agentName,
            review: r.review
        }))
    });
    return await runAgent(
        'summary-agent',
        JSON.stringify(compacted, null, 2)
    );
}