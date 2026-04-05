export class ToolNotFoundError extends Error {
  readonly toolId: string;

  constructor(toolId: string) {
    super(`Tool "${toolId}" not found in registry.`);
    this.name = "ToolNotFoundError";
    this.toolId = toolId;
  }
}

export class ToolPolicyBlockedError extends Error {
  readonly toolId: string;
  readonly reason: string;
  readonly userMessage: string;

  constructor(toolId: string, reason: string, userMessage: string) {
    super(`Tool "${toolId}" blocked by policy: ${reason}`);
    this.name = "ToolPolicyBlockedError";
    this.toolId = toolId;
    this.reason = reason;
    this.userMessage = userMessage;
  }
}

export class ToolExecutionError extends Error {
  readonly toolId: string;

  constructor(toolId: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Tool "${toolId}" execution failed: ${msg}`);
    this.name = "ToolExecutionError";
    this.toolId = toolId;
  }
}
