import {
  BrowserUseAdapter,
  type BrowserTaskCallbacks,
  type BrowserTaskExecutor,
} from "./adapter.js";
import { PlaywrightAdapter } from "./playwright-adapter.js";
import { PuppeteerAdapter } from "./puppeteer-adapter.js";

export type BrowserToolEngine = "browser_use" | "playwright" | "puppeteer";

interface ToolLayerAdapterOptions {
  browserUseApiKey: string;
  defaultEngine?: "auto" | BrowserToolEngine;
  engineOrder?: readonly BrowserToolEngine[];
}

interface BrowserTaskRunOptions {
  allowSubmit?: boolean;
}

export class ToolLayerAdapter implements BrowserTaskExecutor {
  private readonly browserUseApiKey: string;
  private readonly defaultEngine: "auto" | BrowserToolEngine;
  private readonly engineOrder: readonly BrowserToolEngine[];
  private activeEngineAdapter: BrowserTaskExecutor | null = null;
  private cancelled = false;

  constructor(options: ToolLayerAdapterOptions) {
    this.browserUseApiKey = options.browserUseApiKey;
    this.defaultEngine = options.defaultEngine ?? "auto";
    this.engineOrder =
      options.engineOrder && options.engineOrder.length > 0
        ? options.engineOrder
        : ["browser_use", "playwright", "puppeteer"];
  }

  async runSearch(
    query: string,
    callbacks: BrowserTaskCallbacks
  ): Promise<string> {
    return this.runWithFallback(
      "search",
      (adapter) => adapter.runSearch(query, callbacks),
      callbacks
    );
  }

  async runFormFillDraft(
    query: string,
    callbacks: BrowserTaskCallbacks,
    options?: BrowserTaskRunOptions
  ): Promise<string> {
    return this.runWithFallback(
      "form_fill_draft",
      (adapter) => adapter.runFormFillDraft(query, callbacks, options),
      callbacks
    );
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.activeEngineAdapter) {
      await this.activeEngineAdapter.cancel();
    }
  }

  private async runWithFallback(
    taskKind: "search" | "form_fill_draft",
    runTask: (adapter: BrowserTaskExecutor) => Promise<string>,
    callbacks: BrowserTaskCallbacks
  ): Promise<string> {
    this.cancelled = false;
    const orderedEngines = orderEngines(this.defaultEngine, this.engineOrder);
    const errors: string[] = [];

    for (const engine of orderedEngines) {
      if (this.cancelled) {
        return "Task was interrupted.";
      }

      callbacks.onStatus(`Tool layer selecting engine: ${engine}`);
      const adapter = this.createEngineAdapter(engine);
      this.activeEngineAdapter = adapter;

      try {
        const result = await runTask(adapter);
        this.activeEngineAdapter = null;
        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : `${engine} ${taskKind} failed`;
        errors.push(`${engine}: ${errorMessage}`);
        callbacks.onStatus(`Engine ${engine} failed; trying next engine.`);
      } finally {
        this.activeEngineAdapter = null;
      }
    }

    const suffix = errors.length > 0 ? ` ${errors.join(" | ")}` : "";
    throw new Error(`All tool-layer engines failed for ${taskKind}.${suffix}`);
  }

  private createEngineAdapter(engine: BrowserToolEngine): BrowserTaskExecutor {
    switch (engine) {
      case "browser_use":
        return new BrowserUseAdapter(this.browserUseApiKey);
      case "playwright":
        return new PlaywrightAdapter();
      case "puppeteer":
        return new PuppeteerAdapter();
      default: {
        const exhaustive: never = engine;
        throw new Error(`Unsupported tool engine: ${exhaustive}`);
      }
    }
  }
}

export function parseToolEngineOrder(raw: string | undefined): readonly BrowserToolEngine[] {
  if (!raw) {
    return ["browser_use", "playwright", "puppeteer"];
  }

  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is BrowserToolEngine =>
      value === "browser_use" || value === "playwright" || value === "puppeteer"
    );

  if (values.length === 0) {
    return ["browser_use", "playwright", "puppeteer"];
  }

  return Array.from(new Set(values));
}

export function orderEngines(
  defaultEngine: "auto" | BrowserToolEngine,
  engineOrder: readonly BrowserToolEngine[]
): readonly BrowserToolEngine[] {
  const unique = Array.from(new Set(engineOrder));
  if (defaultEngine === "auto") {
    return unique;
  }

  const withoutDefault = unique.filter((engine) => engine !== defaultEngine);
  return [defaultEngine, ...withoutDefault];
}
