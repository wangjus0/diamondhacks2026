import type { ToolDefinition, ToolContext, ToolResult } from "../core/tool-types.js";
import { BrowserAdapter } from "./adapter.js";
import { registerTool } from "../core/tool-registry.js";

function buildWebExtractPrompt(query: string): string {
  return (
    `Based on this request: '${query}', navigate to the relevant webpage. ` +
    `Extract the main textual content of the page. ` +
    `Do NOT click any buttons, fill any forms, or perform any actions that modify the page. ` +
    `Return a clear, concise summary of the page's key content.`
  );
}

export const webExtractTool: ToolDefinition = {
  id: "web_extract",
  name: "Web Extract",
  description: "Navigate to a page and extract/summarize its textual content. Read-only.",
  riskClass: "read_only",
  tags: ["browser", "extract", "read"],

  async execute(ctx: ToolContext): Promise<ToolResult> {
    const browser = new BrowserAdapter(ctx.browserApiKey);

    if (ctx.signal) {
      ctx.signal.addEventListener("abort", () => void browser.cancel(), { once: true });
    }

    try {
      const output = await browser.runTask(
        buildWebExtractPrompt(ctx.query),
        { onStatus: ctx.onStatus }
      );
      return { success: true, output };
    } catch (err) {
      return {
        success: false,
        output: "Failed to extract page content. " + (err instanceof Error ? err.message : ""),
      };
    }
  },
};

registerTool(webExtractTool);
