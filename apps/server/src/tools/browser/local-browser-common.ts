interface SearchResult {
  title: string;
  url: string;
}

export function dynamicImportModule(specifier: string): Promise<unknown> {
  const importFn = new Function(
    "moduleSpecifier",
    "return import(moduleSpecifier);"
  ) as (moduleSpecifier: string) => Promise<unknown>;
  return importFn(specifier);
}

export function extractFirstUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  return urlMatch ? urlMatch[0] : null;
}

export function formatSearchResults(engine: string, results: readonly SearchResult[]): string {
  if (results.length === 0) {
    return `${engine} ran the search but returned no visible result links.`;
  }

  const lines = results.map((result, index) => `${index + 1}. ${result.title} - ${result.url}`);
  return `${engine} search results:\n${lines.join("\n")}`;
}

export function summarizeDraftFill(
  engine: string,
  url: string,
  fields: readonly { label: string; value: string }[]
): string {
  if (fields.length === 0) {
    return `${engine} opened ${url}, but no editable form fields were found.`;
  }

  const lines = fields.map(
    (field, index) => `${index + 1}. ${field.label}: "${field.value}"`
  );

  return (
    `${engine} drafted ${fields.length} form fields at ${url}.\n` +
    `No submit action was performed.\n` +
    `Filled fields:\n${lines.join("\n")}`
  );
}
