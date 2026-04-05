export type RiskClass = "read_only" | "draft_write" | "restricted";

export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly riskClass: RiskClass;
  readonly tags: readonly string[];
  execute(ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  readonly query: string;
  readonly browserApiKey: string;
  readonly onStatus: (message: string) => void;
  readonly signal?: AbortSignal;
}

export interface ToolResult {
  readonly success: boolean;
  readonly output: string;
  readonly metadata?: Record<string, unknown>;
}
