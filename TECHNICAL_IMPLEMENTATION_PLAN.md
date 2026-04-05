# Technical Implementation Plan: Murmur Voice-First Web Agent

## Purpose

This document restates the implementation plan for the functionalities described in `PROJECT_DETAILS.md` and proposes a scalable tool-layer design to unlock additional capabilities beyond the MVP.

## Requirements Restatement

- Build a reliable voice-first loop: speech -> transcript -> intent -> browser action -> narration.
- Support MVP intents:
  - `search`
  - `form_fill_draft` (no final submission)
- Enforce safety with:
  - allowlisted domains
  - dangerous-action blocking
  - interrupt handling
- Provide transparent client UX:
  - live transcript
  - state badge
  - action timeline
  - narration playback
- Keep runtime contracts validated via shared schemas and consistent message envelopes.
- Maintain robust tests for unit, integration, and interrupt reliability.

## Current Codebase Leverage

The existing structure already contains strong foundations:

- shared schemas and event contracts
- websocket gateway/session modules
- orchestrator and state machine structure
- browser adapter and policy modules
- baseline tests

The plan below focuses on contract unification, realtime consolidation, deterministic orchestration, and tool-layer extensibility.

## Target Architecture

### Shared Contract Source

- `packages/shared/src/events/*`
- `packages/shared/src/schemas/*`

Use one typed envelope format everywhere:

- `{ type, payload, requestId, timestamp }`

### Server Control Plane

- `apps/server/src/ws/realtime-gateway.ts` as canonical websocket entrypoint
- `apps/server/src/ws/session.ts` for session lifecycle
- `apps/server/src/orchestrator/*` for turn lifecycle and state transitions

### Tool Execution Plane

- `apps/server/src/tools/browser/adapter.ts` for browser capability
- New tool runtime under `apps/server/src/tools/core/*` for registry, policy, execution, and telemetry

### Client Realtime UX

- `apps/client/src/lib/realtime-client.ts`
- `apps/client/src/lib/contracts.ts`
- voice/transcript/timeline/state components under `apps/client/src/features/*`

## Implementation Phases

### Phase 1: Contract and Realtime Foundation

1. Unify all client/server messages under the shared envelope + zod validation.
2. Consolidate server websocket architecture on `RealtimeGateway`.
3. Align client parser/handlers with canonical envelope and error semantics.

Risk: Medium-High

### Phase 2: Deterministic Turn Orchestration

1. Make `turn-state-machine.ts` the only transition authority:
   - `idle -> listening -> thinking -> acting -> speaking -> idle`
2. Remove ad hoc state mutations from session/orchestrator paths.
3. Thread cancellation (`AbortSignal`) through STT/TTS/browser actions.

Risk: High

### Phase 3: Voice Pipeline Hardening

1. STT resilience:
   - reconnect/backoff
   - chunk validation
   - normalized partial/final transcript events
2. TTS ordering guarantees:
   - sequence IDs for narration text/audio
   - FIFO playback queue with interrupt flush

Risk: Medium

### Phase 4: Browser Execution + Safety Completion (MVP)

1. Wrap browser actions behind standardized tool execution interfaces.
2. Enforce policy checks before every tool execution step, not only intent-level checks.
3. Ensure blocked actions emit structured status with clear reason.

Risk: High

### Phase 5: Client UX Completion

1. Ensure synchronized visibility of:
   - transcript
   - state badge
   - action timeline
   - interrupt controls
2. Handle reconnect and recoverable errors with user-safe messaging.

Risk: Low-Medium

### Phase 6: Optional Persistence (MVP+)

1. Normalize stored session events to replay exactly like live streams.
2. Add replay route consistency checks.

Risk: Medium

### Phase 7: Verification and Demo Readiness

1. Expand tests for:
   - contracts
   - policy blocking
   - turn transitions
   - interrupt cancellation latency
2. Validate critical end-to-end demo paths.

Risk: Medium

## Tool-Layer Expansion Strategy

### Goal

Introduce a reusable tool runtime that supports rapid capability expansion while preserving safety and observability.

### Proposed New Core Modules

- `apps/server/src/tools/core/tool-types.ts`
  - `ToolDefinition`, `ToolContext`, `ToolResult`, `ToolExecutionEvent`
- `apps/server/src/tools/core/tool-registry.ts`
  - register/discover tools and capability tags
- `apps/server/src/tools/core/tool-runner.ts`
  - standard lifecycle: validate -> policy-check -> execute -> emit telemetry
- `apps/server/src/tools/core/tool-policy.ts`
  - reusable centralized policy wrappers
- `apps/server/src/tools/core/tool-errors.ts`
  - typed internal errors + user-safe surfaced messages

### Additional Tools to Add (Post-MVP)

1. `web_extract` (read-only extraction/summarization)
2. `multi_site_compare` (cross-page comparison tables)
3. `calendar_draft` (draft event details, no final confirmation)
4. `email_draft` (draft only, no send)
5. `download_collect` (collect links/files metadata)
6. `tabular_export_draft` (prepare CSV/JSON draft outputs)

### Tool Safety Model

Each tool declares a risk class:

- `read_only`
- `draft_write`
- `restricted`

Enforcement rules:

- pre-execution allowlist and dangerous-action checks for all tools
- explicit policy approvals for higher-risk operations
- keep `submit/pay/checkout/confirm` blocked in MVP
- emit structured action status telemetry with:
  - `toolId`
  - `step`
  - `status`
  - `durationMs`
  - `blockedReason` (when applicable)

## Testing Plan

### Unit

- `tests/unit/intent-classifier.test.ts`
- `tests/unit/policy-checks.test.ts`
- `tests/unit/turn-state-machine.test.ts`
- `tests/unit/tool-registry.test.ts` (new)
- `tests/unit/tool-policy.test.ts` (new)

### Integration

- `tests/integration/transcript-orchestration.test.ts`
- `tests/integration/session-interrupt.test.ts`
- `tests/integration/tool-execution-pipeline.test.ts` (new)

### End-to-End (recommended)

- voice start -> transcript -> search -> narration -> completion
- form-fill draft with blocked submit intent
- interrupt during acting and speaking

## Risks and Mitigations

- Mixed websocket architectures can cause protocol drift.
  - Mitigation: enforce a single canonical gateway path.
- Interrupt may not fully cancel external adapters.
  - Mitigation: required `AbortSignal` support + cancellation latency tests.
- Tool-level behavior can bypass intent-level policy.
  - Mitigation: centralized policy gate in tool runner.
- STT/TTS instability can degrade demos.
  - Mitigation: retries/backoff + graceful fallback narration.
- Client/server contract drift can cause silent failures.
  - Mitigation: shared schema parsing and integration contract tests.

## Success Criteria

- End-to-end voice -> browser -> narration is reliable.
- MVP intents (`search`, `form_fill_draft`) complete on demo domains.
- Interrupt cancels active acting/speaking within the same turn.
- Dangerous actions are blocked before execution.
- Client consistently reflects transcript, action timeline, and state.
- Tool runtime can add at least two post-MVP tools with no orchestrator rewrite.

## Suggested Delivery Sequence

1. Phase 1 + 2 first (contract + state machine + cancellation)
2. Phase 3 + 4 (voice hardening + safe tool-wrapped browser execution)
3. Phase 5 (UX polish)
4. Phase 7 verification gate
5. Phase 6 persistence and post-MVP tool additions
