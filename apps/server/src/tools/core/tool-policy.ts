import type { ToolDefinition, ToolContext } from "./tool-types.js";
import type { PolicyConfig, PolicyDecision, PolicyActionKind } from "../../safety/policy.js";
import { evaluatePolicyAction } from "../../safety/policy.js";

export function evaluateToolPolicy(
  tool: ToolDefinition,
  ctx: ToolContext,
  config: PolicyConfig
): PolicyDecision {
  const kind = tool.id as PolicyActionKind;
  return evaluatePolicyAction({ kind, query: ctx.query }, config);
}
