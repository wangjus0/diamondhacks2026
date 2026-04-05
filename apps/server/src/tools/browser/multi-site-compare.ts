import type { ToolDefinition, ToolContext, ToolResult } from "../core/tool-types.js";
import { BrowserAdapter } from "./adapter.js";
import { registerTool } from "../core/tool-registry.js";

function buildMultiSiteComparePrompt(query: string): string {
  return (
    `Based on this request: '${query}', visit multiple relevant websites to gather comparison data. ` +
    `For each site visited, extract the relevant information (prices, ratings, features, etc.). ` +
    `Do NOT click any buy, add-to-cart, checkout, or form submission buttons. ` +
    `Do NOT fill any forms or perform any actions that modify page state. ` +
    `Return a structured comparison with the site name, URL, and extracted data points for each.`
  );
}

export const multiSiteCompareTool: ToolDefinition = {
  id: "multi_site_compare",
  name: "Multi-Site Compare",
  description: "Visit multiple sites and collect structured comparison data. Read-only.",
  riskClass: "read_only",
  tags: ["browser", "compare", "read", "multi-site"],

  async execute(ctx: ToolContext): Promise<ToolResult> {
    const browser = new BrowserAdapter(ctx.browserApiKey);

    if (ctx.signal) {
      ctx.signal.addEventListener("abort", () => void browser.cancel(), { once: true });
    }

    try {
      const output = await browser.runTask(
        buildMultiSiteComparePrompt(ctx.query),
        { onStatus: ctx.onStatus }
      );
      return { success: true, output };
    } catch (err) {
      return {
        success: false,
        output: "Comparison failed. " + (err instanceof Error ? err.message : ""),
      };
    }
  },
};

registerTool(multiSiteCompareTool);
