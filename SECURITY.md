# Security Policy

## Supported versions

IronClaw is in early development. Security fixes land on the latest tagged release only.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a vulnerability

**Please do not file public GitHub issues for security problems.**

Email **tejogol@gmail.com** with:

- A description of the issue and its impact
- Steps to reproduce (a minimal repro case is ideal)
- Affected versions, if known
- Any relevant logs, screenshots, or proof-of-concept code

You can expect:

- An acknowledgement within **3 business days**
- A triage response within **7 business days** confirming whether the report is accepted
- A fix or mitigation timeline once scope is understood

I'll credit reporters in the release notes unless you'd prefer to stay anonymous.

## Scope

In scope:

- The IronClaw runtime, gateway, and web packages in this repo
- Approval-hook bypass or trust-level escalation
- Credential leakage from the vault or environment
- MCP integration sandboxing gaps
- Authentication / session handling on the web UI

Out of scope:

- Vulnerabilities in upstream dependencies — please report those to the upstream project. I'll still accept reports about dependencies IronClaw uses unsafely.
- Social-engineering attacks that require operator-level access to begin with (the operator is already fully trusted by design)
- Denial-of-service against a self-hosted instance from the same network
- Missing hardening on the default dev Docker compose setup (not intended for production exposure)

## Operator responsibilities

IronClaw is designed to be self-hosted by a single operator. You are responsible for:

- Keeping your `.env` secrets out of version control
- Not exposing the gateway or web UI to the public internet without a reverse proxy and auth layer in front
- Reviewing and approving tool calls from untrusted channels (e.g., Telegram) before allowing them to execute

See the [README](./README.md) for deployment guidance.
