import { describe, it, expect } from "vitest";
import { parseFacts } from "./parse-facts.js";

describe("parseFacts", () => {
  it("parses a valid JSON array", () => {
    const text = 'Here are the facts: ["fact one", "fact two", "fact three"]';
    expect(parseFacts(text)).toEqual(["fact one", "fact two", "fact three"]);
  });

  it("filters empty strings from JSON array", () => {
    const text = '["fact one", "", "  ", "fact two"]';
    expect(parseFacts(text)).toEqual(["fact one", "fact two"]);
  });

  it("filters non-string values from JSON array", () => {
    const text = '["fact one", 123, null, "fact two"]';
    expect(parseFacts(text)).toEqual(["fact one", "fact two"]);
  });

  it("returns empty array for non-JSON text without fallback", () => {
    expect(parseFacts("no json here")).toEqual([]);
  });

  it("returns empty array for invalid JSON without fallback", () => {
    expect(parseFacts("[invalid json}")).toEqual([]);
  });

  it("extracts facts from lines when fallback is enabled", () => {
    const text = "- This is a longer fact about something\n- Another fact that is also long enough\n- Short";
    const result = parseFacts(text, true);
    expect(result).toContain("This is a longer fact about something");
    expect(result).toContain("Another fact that is also long enough");
    // "Short" is under 10 chars, should be filtered
    expect(result).not.toContain("Short");
  });

  it("strips bullet markers in fallback mode", () => {
    const text = "• This is a bullet point fact here\n* This is a star point fact here\n- This is a dash point fact here";
    const result = parseFacts(text, true);
    expect(result).toContain("This is a bullet point fact here");
    expect(result).toContain("This is a star point fact here");
    expect(result).toContain("This is a dash point fact here");
  });

  it("filters lines starting with [ or { in fallback mode", () => {
    const text = "A real fact that is long enough\n[not a fact, looks like JSON\n{also not a fact";
    const result = parseFacts(text, true);
    expect(result).toEqual(["A real fact that is long enough"]);
  });

  it("handles empty input", () => {
    expect(parseFacts("")).toEqual([]);
    expect(parseFacts("", true)).toEqual([]);
  });

  it("prefers JSON array over fallback", () => {
    const text = 'Some text\n["json fact"]\nMore text that is long enough for fallback';
    expect(parseFacts(text, true)).toEqual(["json fact"]);
  });
});
