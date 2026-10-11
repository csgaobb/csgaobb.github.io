import { queryTokens } from "./search";

export function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = queryTokens(query);
  if (!text || tokens.length === 0) return text;

  const pattern = new RegExp(
    `(${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "ig",
  );
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) => {
        const matched = tokens.some((token) => token.toLowerCase() === part.toLowerCase());
        return matched ? (
          <mark key={`${part}-${index}`} className="rounded-sm bg-cyan-100 px-0.5 text-cyan-950">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </>
  );
}
