import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export const REMARK_PLUGINS = [remarkGfm];

// Force a blank line before ATX headings glued to previous text; otherwise
// '##' renders literally (CommonMark requires headings to start a line).
// Requires a non-whitespace char before the hashes so we don't corrupt
// trailing comments in code blocks (e.g. Python/Bash `x = 1 # comment`).
export function normalizeMarkdown(text: string): string {
  if (!text.includes("#")) return text;
  return text.replace(/([^\s])(#{1,6} )/g, "$1\n\n$2");
}

function CodeBlock(props: React.HTMLAttributes<HTMLElement>) {
  const { className, children, ...rest } = props;
  const isDiff = /\blanguage-diff\b/.test(className ?? "");
  if (!isDiff) {
    return <code className={className} {...rest}>{children}</code>;
  }
  const raw = String(children).replace(/\n$/, "");
  return (
    <code className={className} {...rest}>
      {raw.split("\n").map((line, i) => {
        // Skip coloring the "+++"/"---" file-header lines.
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isDel = line.startsWith("-") && !line.startsWith("---");
        const bg = isAdd ? "bg-green-500/15" : isDel ? "bg-red-500/15" : "";
        const fg = isAdd ? "text-green-700 dark:text-green-400" : isDel ? "text-red-700 dark:text-red-400" : "";
        return (
          <span key={i} className={`block ${bg} ${fg}`}>
            {line || "\u00A0"}
          </span>
        );
      })}
    </code>
  );
}

export const MARKDOWN_COMPONENTS: Components = {
  code: CodeBlock,
};
