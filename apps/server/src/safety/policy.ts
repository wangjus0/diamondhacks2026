import type { IntentResult } from "@murmur/shared";

export type PolicyBlockReason =
  | "domain_not_allowlisted"
  | "invalid_navigation_target"
  | "dangerous_action"
  | "final_form_submission_blocked";

export type PolicyActionKind =
  | "navigate"
  | "search"
  | "form_fill_draft"
  | "clarify"
  | "submit"
  | "pay"
  | "checkout"
  | "confirm"
  | "web_extract"
  | "multi_site_compare"
  | "quick_answer";

export interface PolicyAction {
  readonly kind: PolicyActionKind;
  readonly query?: string;
  readonly targetUrl?: string;
}

export interface PolicyConfig {
  readonly navigationAllowlist: readonly string[];
  readonly allowFinalFormSubmission: boolean;
}

export type PolicyDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: PolicyBlockReason;
      readonly message: string;
    };

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function isAllowlistedDomain(hostname: string, allowlist: readonly string[]): boolean {
  const normalizedHost = normalizeDomain(hostname);

  return allowlist.some((entry) => {
    const normalizedEntry = normalizeDomain(entry);
    return (
      normalizedHost === normalizedEntry ||
      normalizedHost.endsWith(`.${normalizedEntry}`)
    );
  });
}

function parseDomainFromUrl(targetUrl: string): string | null {
  try {
    const parsed = new URL(targetUrl);
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function parseNavigationAllowlist(input: string | undefined): readonly string[] {
  return (input ?? "")
    .split(",")
    .map((value) => normalizeDomain(value))
    .filter((value) => value.length > 0);
}

export function createPolicyConfig(
  navigationAllowlist: string | undefined,
  allowFinalFormSubmission = false
): PolicyConfig {
  return {
    navigationAllowlist: parseNavigationAllowlist(navigationAllowlist),
    allowFinalFormSubmission,
  };
}

const FINAL_SUBMISSION_PATTERN =
  /\b(submit|confirm(?:ation)?|final\s+confirm(?:ation)?|send|finish)\b/i;

const PAYMENT_OR_CHECKOUT_PATTERN =
  /\b(pay|checkout|purchase|place\s+order)\b/i;

export function evaluatePolicyAction(
  action: PolicyAction,
  config: PolicyConfig
): PolicyDecision {
  if (action.kind === "navigate" && action.targetUrl) {
    const domain = parseDomainFromUrl(action.targetUrl);
    if (!domain) {
      return {
        allowed: false,
        reason: "invalid_navigation_target",
        message:
          "I blocked this action because the destination URL looks invalid.",
      };
    }

    if (!isAllowlistedDomain(domain, config.navigationAllowlist)) {
      return {
        allowed: false,
        reason: "domain_not_allowlisted",
        message:
          "I can only navigate to approved domains right now, so I blocked that destination.",
      };
    }
  }

  if (
    action.kind === "pay" ||
    action.kind === "checkout"
  ) {
    return {
      allowed: false,
      reason: "dangerous_action",
      message:
        "I blocked that action for safety. Payments, checkout, and final confirmations are disabled.",
    };
  }

  if (action.kind === "submit" || action.kind === "confirm") {
    if (config.allowFinalFormSubmission) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: "dangerous_action",
      message:
        "I blocked that action for safety. Final confirmations are disabled.",
    };
  }

  if (action.kind === "form_fill_draft" && action.query) {
    if (PAYMENT_OR_CHECKOUT_PATTERN.test(action.query)) {
      return {
        allowed: false,
        reason: "dangerous_action",
        message:
          "I blocked that action for safety. Payments and checkout are disabled.",
      };
    }

    if (FINAL_SUBMISSION_PATTERN.test(action.query) && !config.allowFinalFormSubmission) {
      return {
        allowed: false,
        reason: "final_form_submission_blocked",
        message:
          "I can draft form fields, but I cannot submit or confirm the form in this MVP.",
      };
    }
  }

  if (action.query && PAYMENT_OR_CHECKOUT_PATTERN.test(action.query)) {
    return {
      allowed: false,
      reason: "dangerous_action",
      message:
        "I blocked that action for safety. Payments, checkout, and final confirmations are disabled.",
    };
  }

  if (
    action.query &&
    FINAL_SUBMISSION_PATTERN.test(action.query) &&
    !config.allowFinalFormSubmission
  ) {
    return {
      allowed: false,
      reason: "final_form_submission_blocked",
      message:
        "I can draft form fields, but I cannot submit or confirm the form in this MVP.",
    };
  }

  return { allowed: true };
}

function extractNavigationTargetFromText(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    return urlMatch[0];
  }

  const domainMatch = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/i);
  if (!domainMatch) {
    return null;
  }

  return `https://${domainMatch[0]}`;
}

export function evaluateIntentPolicy(
  intent: IntentResult,
  config: PolicyConfig
): PolicyDecision {
  const action: PolicyAction = {
    kind: intent.intent,
    query: intent.query,
  };

  if (intent.intent === "search") {
    const targetUrl = extractNavigationTargetFromText(intent.query);
    if (targetUrl) {
      const navigationDecision = evaluatePolicyAction(
        {
          kind: "navigate",
          targetUrl,
          query: intent.query,
        },
        config
      );

      if (!navigationDecision.allowed) {
        return navigationDecision;
      }
    }
  }

  return evaluatePolicyAction(action, config);
}

export function logPolicyBlock(details: {
  readonly reason: PolicyBlockReason;
  readonly intent: IntentResult["intent"];
  readonly query: string;
}): void {
  const normalizedQuery = details.query.trim();
  const payload = {
    reason: details.reason,
    intent: details.intent,
    queryRedacted: normalizedQuery.length > 0,
    queryLength: normalizedQuery.length,
  };

  console.warn(`[Safety] Blocked action: ${JSON.stringify(payload)}`);
}
