import type {
  BrowserTaskCallbacks,
  BrowserTaskExecutor,
  BrowserTaskRunOptions,
} from "./adapter.js";
import {
  dynamicImportModule,
  extractFirstUrl,
  formatSearchResults,
  summarizeDraftFill,
} from "./local-browser-common.js";

const SEARCH_TIMEOUT_MS = 45_000;

export class PuppeteerAdapter implements BrowserTaskExecutor {
  private cancelRequested = false;

  async runSearch(
    query: string,
    callbacks: BrowserTaskCallbacks,
    _options?: BrowserTaskRunOptions
  ): Promise<string> {
    callbacks.onStatus("Launching Puppeteer...");
    const puppeteer = await loadPuppeteer();
    const browser = await puppeteer.launch({ headless: true });

    try {
      if (this.cancelRequested) {
        return "Task was interrupted.";
      }

      const page = await browser.newPage();
      const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
      callbacks.onStatus(`Puppeteer navigating to ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS });
      await page.waitForTimeout(1_000);

      const results = (await page.evaluate(() => {
        const doc = (globalThis as unknown as { document?: { querySelectorAll: (s: string) => unknown[] } })
          .document;
        if (!doc) {
          return [];
        }

        const anchors = Array.from(
          doc.querySelectorAll(
            "a[data-testid='result-title-a'], a.result__a, article h2 a, a[href]"
          ) as unknown[]
        );

        const seen = new Set<string>();
        const output: Array<{ title: string; url: string }> = [];

        for (const item of anchors) {
          if (output.length >= 5) {
            break;
          }

          const anchor = item as {
            textContent?: string | null;
            href?: string;
          };

          const title = (anchor.textContent ?? "").trim();
          const href = anchor.href ?? "";
          if (!title || !href || seen.has(href)) {
            continue;
          }

          if (!/^https?:\/\//i.test(href)) {
            continue;
          }

          seen.add(href);
          output.push({ title, url: href });
        }

        return output;
      })) as Array<{ title: string; url: string }>;

      callbacks.onStatus(`Puppeteer captured ${results.length} results`);
      return formatSearchResults("Puppeteer", results);
    } finally {
      await browser.close();
    }
  }

  async runFormFillDraft(
    query: string,
    callbacks: BrowserTaskCallbacks,
    _options?: BrowserTaskRunOptions
  ): Promise<string> {
    const url = extractFirstUrl(query);
    if (!url) {
      throw new Error("Puppeteer form-fill draft requires an explicit URL in the request.");
    }

    callbacks.onStatus("Launching Puppeteer...");
    const puppeteer = await loadPuppeteer();
    const browser = await puppeteer.launch({ headless: true });

    try {
      if (this.cancelRequested) {
        return "Task was interrupted.";
      }

      const page = await browser.newPage();
      callbacks.onStatus(`Puppeteer opening form page ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS });

      const filledFields = (await page.evaluate(() => {
        const doc = (globalThis as unknown as { document?: { querySelectorAll: (s: string) => unknown[] } })
          .document;
        if (!doc) {
          return [];
        }

        const elements = Array.from(doc.querySelectorAll("input, textarea, select") as unknown[]);
        const outputs: Array<{ label: string; value: string }> = [];
        const selectText = (node: unknown) =>
          ((node as { textContent?: string | null }).textContent ?? "").trim();

        for (const element of elements) {
          if (outputs.length >= 12) {
            break;
          }

          const control = element as {
            tagName?: string;
            type?: string;
            name?: string;
            id?: string;
            placeholder?: string;
            disabled?: boolean;
            value?: string;
            options?: Array<{ value?: string; disabled?: boolean; selected?: boolean }>;
            dispatchEvent?: (event: unknown) => void;
          };

          const tag = (control.tagName ?? "").toLowerCase();
          const type = (control.type ?? "").toLowerCase();
          if (control.disabled) {
            continue;
          }

          if (tag === "input" && ["hidden", "submit", "button", "reset", "file"].includes(type)) {
            continue;
          }

          const descriptor = [
            control.name ?? "",
            control.id ?? "",
            control.placeholder ?? "",
            selectText(element),
          ]
            .join(" ")
            .toLowerCase();

          let value = "Draft value";
          if (descriptor.includes("email")) value = "alex.taylor@example.com";
          else if (descriptor.includes("phone")) value = "555-010-0199";
          else if (descriptor.includes("first")) value = "Alex";
          else if (descriptor.includes("last")) value = "Taylor";
          else if (descriptor.includes("name")) value = "Alex Taylor";
          else if (descriptor.includes("company")) value = "Murmur Labs";
          else if (descriptor.includes("message") || descriptor.includes("comment")) {
            value = "Hi, this is a draft message generated by Murmur.";
          }

          if (tag === "select") {
            const options = control.options ?? [];
            const firstOption = options.find(
              (option) => !option.disabled && (option.value ?? "").trim().length > 0
            );
            if (firstOption) {
              control.value = firstOption.value ?? "";
              value = control.value;
            } else {
              continue;
            }
          } else {
            control.value = value;
          }

          control.dispatchEvent?.(new Event("input", { bubbles: true }));
          control.dispatchEvent?.(new Event("change", { bubbles: true }));

          outputs.push({
            label: control.name || control.id || control.placeholder || `${tag}:${outputs.length + 1}`,
            value,
          });
        }

        return outputs;
      })) as Array<{ label: string; value: string }>;

      callbacks.onStatus(`Puppeteer drafted ${filledFields.length} fields`);
      return summarizeDraftFill("Puppeteer", url, filledFields);
    } finally {
      await browser.close();
    }
  }

  async cancel(): Promise<void> {
    this.cancelRequested = true;
  }
}

async function loadPuppeteer(): Promise<{
  launch: (options?: Record<string, unknown>) => Promise<any>;
}> {
  try {
    return (await dynamicImportModule("puppeteer")) as {
      launch: (options?: Record<string, unknown>) => Promise<any>;
    };
  } catch (error) {
    throw new Error(
      `Puppeteer is unavailable. Install it with 'npm i puppeteer'. ${error instanceof Error ? error.message : ""}`
    );
  }
}
