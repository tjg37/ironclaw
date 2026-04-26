---
name: add-telegram
description: Add Telegram channel to IronClaw — guides through bot creation, token configuration, and verification
---

# /add-telegram — Add Telegram Channel

Guide the user through connecting a Telegram bot to IronClaw.

## Step 1: Create a Telegram Bot

- Tell the user to open Telegram and message @BotFather
- Send `/newbot` to BotFather
- Choose a name (e.g., "IronClaw") and username (e.g., "ironclaw_bot")
- Copy the bot token that BotFather provides

## Step 2: Get Your Telegram User ID

- Tell the user to message @userinfobot on Telegram
- It will reply with their user ID (a number like 123456789)
- This is needed so IronClaw knows which Telegram user is the operator

## Step 3: Configure Environment

- Add both values to `.env`:
  ```
  TELEGRAM_BOT_TOKEN=<bot-token-from-botfather>
  TELEGRAM_OPERATOR_ID=<your-user-id>
  ```
- Remind the user that `.env` is in `.gitignore`

## Step 4: Start the Gateway

- If the gateway is running, restart it to pick up the new env vars
- Start with: `pnpm start:gateway`
- Also start the runtime worker in another terminal: `pnpm start:runtime`
- The gateway should show `[telegram] Bot started (polling)`

## Step 5: Verify

- Open Telegram and find the bot by its username
- Send `/start` — should get a welcome message
- Send a message like "Hello!" — should get a response from IronClaw
- The response comes from the same agent with the same memory and tools

## Step 6: DM Pairing (for other users)

Explain the pairing flow:
- Another user messages the bot and sends `/pair`
- They get a 6-digit pairing code
- The operator sends `/approve <code>` to the bot to approve them
- Once approved, the user can chat with the bot in their own DM session

## Notes

- Long polling is used for local development (no public URL needed)
- For production, set `TELEGRAM_WEBHOOK_URL` in `.env` to use webhooks instead
- The operator's messages go to the "main" session (same as CLI)
- Other users' DMs create separate `dm:telegram:<userId>` sessions
- Group chats create `group:telegram:<chatId>` sessions
