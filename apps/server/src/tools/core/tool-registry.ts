import type { ToolDefinition } from "./tool-types.js";

const registry = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.id)) {
    throw new Error(`Tool "${tool.id}" is already registered.`);
  }
  registry.set(tool.id, tool);
}

export function getTool(id: string): ToolDefinition | undefined {
  return registry.get(id);
}

export function getToolsByTag(tag: string): ToolDefinition[] {
  return Array.from(registry.values()).filter((t) => t.tags.includes(tag));
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(registry.values());
}
