# ADR-001: Migration from Direct Anthropic API to Claude Agent SDK

**Status:** Accepted
**Date:** 2026-03-19
**Context:** Sprints 1-7 complete with direct API approach

## Decision

Migrate IronClaw's agent runtime from the direct Anthropic Messages API with custom tool execution to the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).

## Context

Sprints 1-7 built a working personal AI agent using the direct Anthropic API with a custom tool execution loop. This included:
- Custom agent loop (`agent-loop.ts`) managing the LLM → tool call → execute → feed result cycle
- Tool registry with permission enforcement
- Tool executor with approval handling and rate limiting
- Built-in tools: bash (allowlisted), file read/write, HTTP fetch
- Docker sandbox routing for non-operator sessions
- Prompt injection defenses

While functional, this approach has limitations:
1. The agent can only use pre-built tools — it cannot write code to solve novel problems
2. The bash tool is restricted to an allowlist of safe commands
3. Every new capability requires implementing a new tool
4. The custom tool execution loop doesn't benefit from Anthropic's ongoing improvements

## Rationale

### What the Claude Agent SDK provides

The SDK wraps Claude Code — the same engine that powers Anthropic's coding assistant. It provides:
- **Built-in tools**: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Agent (subagents)
- **Code writing and execution**: The agent can write scripts, install packages, debug errors
- **MCP integration**: Custom tools defined as in-process MCP servers — no IPC protocol needed
- **Hooks**: Intercept tool calls before/after execution for approval, logging, and security
- **Permission modes**: Fine-grained control over what the agent can do
- **Subagents**: Spawn specialized agents for complex tasks

### Why now

- The SDK became available at a natural refactoring point, and was lower-risk than the alternatives under consideration.
- The current codebase is lean — refactoring now is easier than after adding more layers.
- The SDK is mature enough for production use (powers Claude Code itself).

### What stays unchanged

- Gateway process (WebSocket, HTTP, NATS pub/sub, Telegram adapter)
- Database schema, repositories, memory system
- Session management, message routing
- Web app (chat + approvals pages)
- Container hardening (read-only source mounts, mount allowlists, non-root execution)
- Credential vault

### What changes

| Before (Direct API) | After (Agent SDK) |
|---|---|
| Custom `runAgentLoop()` | SDK `query()` function |
| Custom tool registry + executor | SDK built-in tools + MCP servers |
| Bash allowlist tool | SDK's native Bash tool with hooks |
| File read/write tools | SDK's native Read/Write/Edit tools |
| HTTP fetch tool | SDK's native WebFetch tool |
| Sandbox router for non-operator | Container with Claude Code CLI installed |
| Application-level permission enforcement | Container boundary + hooks |
| Prompt injection defenses in system prompt | SDK's built-in safety features + hooks |

### IPC concern — resolved

The initial concern was how an agent inside a Docker container would communicate with external services (Telegram, database, credentials). The SDK resolves this through its MCP system: custom tools defined as in-process MCP servers run in the Runtime process with full access to NATS, the database, and the Gateway. The agent calls them naturally — no custom IPC protocol needed.

### Security model shift

- **Before**: Application-level permission checks on every tool call
- **After**: Container boundary is the primary security mechanism. Hooks provide tool-level interception for approval and auditing. MCP tools handle external actions with our own validation.

This aligns with Design Principle 2: "Security is a hard boundary, not a soft suggestion."

## Consequences

### Positive
- Agent can write code, debug, install packages — fundamentally more capable
- Codebase shrinks (~30-40% of runtime package removed)
- Benefits from Claude Code improvements automatically
- Management tools become simpler MCP implementations
- Audit trail preserved via PostToolUse hooks

### Negative
- Dependency on Claude Code CLI in containers (must be installed in sandbox image)
- Less granular control over individual tool invocations inside a session
- Container image size increases (~100MB for Claude Code CLI)

### Risks
- Breaking changes in Claude Code CLI could affect sandboxed sessions
- Mitigation: pin CLI version in Dockerfile, test before updating
