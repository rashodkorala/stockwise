"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseCommand } from "@/lib/commands";

export default function CommandBar() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");

  // "/" focuses the command line from anywhere, like a terminal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function run(e: React.FormEvent) {
    e.preventDefault();
    const cmd = parseCommand(value);
    if (!cmd) return;
    if (cmd.kind === "message") {
      setMessage(cmd.text);
      return;
    }
    setMessage("");
    setValue("");
    router.push(cmd.href);
  }

  return (
    <form className="cmd" onSubmit={run} role="search">
      <span className="cmd-prompt" aria-hidden>
        &gt;
      </span>
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="XEQT · XEQT VEQT OVLP · PORT   (press / to focus)"
        aria-label="Command"
        autoComplete="off"
        spellCheck={false}
      />
      <button className="btn" type="submit">
        GO
      </button>
      {message && (
        <span className="cmd-msg" role="status">
          {message}
        </span>
      )}
    </form>
  );
}
