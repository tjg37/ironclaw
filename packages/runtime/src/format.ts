/**
 * Lightweight markdown-to-terminal renderer.
 * Handles: bold, italic, headers, tables, code blocks, lists.
 */

const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const italic = (s: string) => `\x1b[3m${s}\x1b[23m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, (_m, p1: string) => bold(p1))
    .replace(/\*(.+?)\*/g, (_m, p1: string) => italic(p1))
    .replace(/`(.+?)`/g, (_m, p1: string) => cyan(p1));
}

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;

    // Code blocks
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        output.push(dim("─".repeat(40)));
      } else {
        output.push(dim("─".repeat(40)));
      }
      continue;
    }

    if (inCodeBlock) {
      output.push(dim("  " + line));
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      output.push(bold(cyan(headerMatch[2]!)));
      continue;
    }

    // Table rows
    if (line.includes("|") && line.trim().startsWith("|")) {
      // Skip separator rows (|---|---|)
      if (line.match(/^\|[\s-:|]+\|$/)) continue;

      const cells = line.split("|").filter(Boolean).map((c) => formatInline(c.trim()));
      // Check if this is a header row (next line is separator)
      const nextLine = lines[i + 1];
      const isHeader = nextLine && nextLine.match(/^\|[\s-:|]+\|$/);

      if (isHeader) {
        output.push(cells.map((c) => bold(padCell(c, 16))).join("  "));
      } else {
        output.push(cells.map((c) => padCell(c, 16)).join("  "));
      }
      continue;
    }

    output.push(formatInline(line));
  }

  return output.join("\n");
}

function padCell(text: string, width: number): string {
  // Strip ANSI for length calculation
  const stripped = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  const pad = Math.max(0, width - stripped.length);
  return text + " ".repeat(pad);
}
