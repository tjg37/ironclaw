# Security Audit Skill

When the user asks for a security audit or security check of the IronClaw deployment, perform the following checks and report findings with severity levels (CRITICAL, WARNING, INFO).

## Checks to perform

1. **Encryption key** — Check if `IRONCLAW_ENCRYPTION_KEY` is set (exists) in the environment. **IMPORTANT: Do NOT print or read the actual value — only check for existence.** Use the `file_read` tool to check if `.env` contains a line starting with `IRONCLAW_ENCRYPTION_KEY=` (without revealing the value). If not set, report as CRITICAL: credentials at rest are unencrypted.

2. **Mount allowlist** — Use `file_read` to check if `~/.config/ironclaw/mount-allowlist.json` exists. If it exists, verify it has a valid `allowed` array and a `denied` array. If missing, report as WARNING: sandbox mount permissions are unconfigured (no extra mounts allowed, but no custom deny rules either).

3. **Gateway token** — Check if `.env` contains a line starting with `GATEWAY_WS_TOKEN=` (without revealing the value). If not set, report as CRITICAL: gateway WebSocket connections are unauthenticated.

4. **Environment file** — Use `file_read` to read the `.env` file. Check that it exists and that secret values (API keys, tokens, passwords) are not empty or placeholder values. **Do NOT include the actual secret values in your output.** Report as WARNING if any required secrets appear to be missing or placeholder. If `.env` does not exist, report as INFO.

5. **Docker sandbox** — Use `bash` to run `docker info` (the `docker` command is not in the bash allowlist, so report if you cannot check). Check if the sandbox image is available. Report as WARNING if Docker is not running or the image is missing.

## Output format

Print a summary table:

```
IronClaw Security Audit
========================

[CRITICAL] Encryption key not set — credentials stored unencrypted
[OK]       Mount allowlist configured
[WARNING]  Gateway token not set
[INFO]     No .env file found
[OK]       Docker running, sandbox image available

Summary: 1 critical, 1 warning, 1 info
```

**SECURITY: Never print, echo, or include actual secret values (API keys, tokens, encryption keys, passwords) in the audit output. Only report whether they are set or not.**
