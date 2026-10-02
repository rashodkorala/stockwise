export type Command =
  | { kind: "navigate"; href: string }
  | { kind: "message"; text: string };

const TICKER = /^[A-Z0-9][A-Z0-9.:\-]{0,11}$/;

/**
 * Parses Bloomberg-style mnemonics:
 *   XEQT            X-ray a fund (also "XEQT GO")
 *   XEQT VEQT OVLP  compare two funds (also "OVLP XEQT VEQT", "XEQT VS VEQT")
 *   PORT            portfolio
 *   HELP            command list
 */
export function parseCommand(input: string): Command | null {
  const words = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const [first] = words;

  if (first === "HELP" || first === "?") return { kind: "navigate", href: "/" };
  if (first === "PORT" || first === "PRT") return { kind: "navigate", href: "/portfolio" };

  const rest = words.filter((w) => !["OVLP", "VS", "GO", "<GO>"].includes(w));
  const isOverlap = words.includes("OVLP") || words.includes("VS");
  if (isOverlap) {
    if (rest.length !== 2 || !rest.every((t) => TICKER.test(t))) {
      return { kind: "message", text: "Overlap takes two tickers: XEQT VEQT OVLP" };
    }
    return { kind: "navigate", href: `/compare?a=${encodeURIComponent(rest[0])}&b=${encodeURIComponent(rest[1])}` };
  }

  if (words.includes("FLOW") || words.includes("CO")) {
    return { kind: "message", text: "Company money-flow view is coming in the next phase." };
  }

  if (rest.length === 1 && TICKER.test(rest[0])) {
    return { kind: "navigate", href: `/etf/${encodeURIComponent(rest[0])}` };
  }
  return { kind: "message", text: `Unknown command "${input.trim()}". Type HELP for the list.` };
}
