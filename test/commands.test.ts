import { describe, expect, it } from "vitest";
import { parseCommand } from "@/lib/commands";

describe("parseCommand", () => {
  it.each([
    ["xeqt", "/etf/XEQT"],
    ["XEQT GO", "/etf/XEQT"],
    ["XEQT.TO <GO>", "/etf/XEQT.TO"],
    ["XEQT VEQT OVLP", "/compare?a=XEQT&b=VEQT"],
    ["ovlp xeqt veqt", "/compare?a=XEQT&b=VEQT"],
    ["XEQT vs VTI", "/compare?a=XEQT&b=VTI"],
    ["PORT", "/portfolio"],
    ["help", "/"],
  ])("%s goes to %s", (input, href) => {
    expect(parseCommand(input)).toEqual({ kind: "navigate", href });
  });

  it("explains malformed commands", () => {
    expect(parseCommand("XEQT OVLP")).toMatchObject({ kind: "message" });
    expect(parseCommand("what is this")).toMatchObject({ kind: "message" });
    expect(parseCommand("   ")).toBeNull();
  });
});
