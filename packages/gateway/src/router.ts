/**
 * Resolves a channel + sender combination to a session key.
 *
 * Session key determines which agent session handles the conversation:
 * - "main" for CLI and operator-identified users
 * - "dm:<channel>:<senderId>" for private chats
 * - "group:<channel>:<chatId>" for group chats
 */
export function resolveSessionKey(
  channel: string,
  senderId: string,
  chatId?: string,
  operatorId?: string,
): string {
  if (channel === "cli") {
    return "main";
  }

  if (channel === "webchat") {
    return "main";
  }

  if (channel === "telegram") {
    // Operator gets the main session
    if (operatorId && senderId === operatorId) {
      return "main";
    }
    // Group chats (negative chat IDs in Telegram)
    if (chatId && chatId.startsWith("-")) {
      return `group:telegram:${chatId}`;
    }
    // Private DMs
    return `dm:telegram:${senderId}`;
  }

  // Default: DM-style key
  return `dm:${channel}:${senderId}`;
}
