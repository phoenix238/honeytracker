import Anthropic from '@anthropic-ai/sdk';

// One place that builds the Claude client. A key made at organisation level (not inside a
// workspace) must name its workspace on every request; ANTHROPIC_WORKSPACE_ID supplies it.
export function anthropicClient(): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
}
