import type { ToolContext, ToolResult } from "./tool-types.js";
import type { PolicyConfig } from "../../safety/policy.js";
import { getTool } from "./tool-registry.js";
import { evaluateToolPolicy } from "./tool-policy.js";
import { ToolNotFoundError, ToolPolicyBlockedError, ToolExecutionError } from "./tool-errors.js";

export async function runTool(
  toolId: string,
  ctx: ToolContext,
  policyConfig: PolicyConfig
): Promise<ToolResult> {
  const tool = getTool(toolId);
  if (!tool) {
    throw new ToolNotFoundError(toolId);
  }

  const decision = evaluateToolPolicy(tool, ctx, policyConfig);
  if (!decision.allowed) {
    throw new ToolPolicyBlockedError(toolId, decision.reason, decision.message);
  }

  const startMs = Date.now();
  ctx.onStatus(`Running tool: ${tool.name}...`);

  try {
    const result = await tool.execute(ctx);
    const elapsedMs = Date.now() - startMs;
    console.log(`[ToolRunner] ${toolId} completed in ${elapsedMs}ms, success=${result.success}`);
    return result;
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    console.error(`[ToolRunner] ${toolId} failed after ${elapsedMs}ms:`, err);
    throw new ToolExecutionError(toolId, err);
  }
}
