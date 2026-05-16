/**
 * Historical entry point for "infra" PR jobs. Logic now lives in
 * review-dev-pr.ts: devops-agent runs when the diff matches
 * AGENT_FILE_RULES['devops-agent']; otherwise only development agents apply
 * (via their own rules).
 */
import './review-dev-pr';
