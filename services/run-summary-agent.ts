import { runAgent } from './run-agent';
import { SummaryAgentInput } from '../models/summary-agent-input';

export async function runSummaryAgent(input: SummaryAgentInput) {
    return await runAgent(
        'summary-agent',
        JSON.stringify(input, null, 2)
    );
}