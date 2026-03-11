import { test, expect, describe } from "bun:test"
import { matchHook } from "./matcher.js"

describe("matchHook", () => {
  // 1. undefined matcher + any value → true
  test("undefined matcher matches everything", () => {
    expect(matchHook(undefined, "Bash")).toBe(true)
    expect(matchHook(undefined, "Edit")).toBe(true)
    expect(matchHook(undefined, "")).toBe(true)
  })

  // 2. "" matcher + any value → true
  test("empty string matcher matches everything", () => {
    expect(matchHook("", "Bash")).toBe(true)
    expect(matchHook("", "Edit")).toBe(true)
    expect(matchHook("", "")).toBe(true)
  })

  // 3. "*" matcher + any value → true
  test('"*" matcher matches everything', () => {
    expect(matchHook("*", "Bash")).toBe(true)
    expect(matchHook("*", "Edit")).toBe(true)
    expect(matchHook("*", "")).toBe(true)
  })

  // 4. Exact match: "Bash" + "Bash" → true
  test("exact match returns true", () => {
    expect(matchHook("Bash", "Bash")).toBe(true)
  })

  // 5. No match: "Bash" + "Edit" → false
  test("non-matching pattern returns false", () => {
    expect(matchHook("Bash", "Edit")).toBe(false)
  })

  // 6. Regex pattern: "Edit|Write" + "Edit" → true
  test('alternation pattern matches "Edit"', () => {
    expect(matchHook("Edit|Write", "Edit")).toBe(true)
  })

  // 7. Regex pattern: "Edit|Write" + "Write" → true
  test('alternation pattern matches "Write"', () => {
    expect(matchHook("Edit|Write", "Write")).toBe(true)
  })

  // 8. Regex pattern: "Edit|Write" + "Bash" → false
  test('alternation pattern does not match "Bash"', () => {
    expect(matchHook("Edit|Write", "Bash")).toBe(false)
  })

  // 9. Case insensitivity: "Bash" + "bash" → true (Claude Code settings use "Bash" but OpenCode passes "bash")
  test("matching is case-insensitive", () => {
    expect(matchHook("Bash", "bash")).toBe(true)
    expect(matchHook("bash", "Bash")).toBe(true)
    expect(matchHook("BASH", "bash")).toBe(true)
    expect(matchHook("edit", "Edit")).toBe(true)
  })

  // 10. Partial match: "Bash" + "BashExtended" → true
  test("partial (substring) match returns true", () => {
    expect(matchHook("Bash", "BashExtended")).toBe(true)
  })

  // 11. Anchored match: "^Bash$" + "BashExtended" → false
  test("anchored pattern does not partially match", () => {
    expect(matchHook("^Bash$", "BashExtended")).toBe(false)
  })

  // 12. undefined value → true
  test("undefined value always matches (non-tool events)", () => {
    expect(matchHook("Bash", undefined)).toBe(true)
    expect(matchHook("Edit|Write", undefined)).toBe(true)
    expect(matchHook(undefined, undefined)).toBe(true)
  })

  // 13. Invalid regex → false (does not throw)
  test("invalid regex returns false without throwing", () => {
    expect(() => matchHook("[invalid", "Bash")).not.toThrow()
    expect(matchHook("[invalid", "Bash")).toBe(false)
    expect(matchHook("(unclosed", "Bash")).toBe(false)
  })

  // 14. Complex regex: "(Read|Write|Edit).*" + "ReadFile" → true
  test("complex regex matches correctly", () => {
    expect(matchHook("(Read|Write|Edit).*", "ReadFile")).toBe(true)
    expect(matchHook("(Read|Write|Edit).*", "WriteOutput")).toBe(true)
    expect(matchHook("(Read|Write|Edit).*", "EditConfig")).toBe(true)
    expect(matchHook("(Read|Write|Edit).*", "Bash")).toBe(false)
  })
})
