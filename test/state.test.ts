import { describe, expect, test } from "bun:test"
import { DtocState, metadataFor, renderToolOutput } from "../src/state.js"

describe("DTOC state", () => {
  test("assigns stable keys and counts characters", () => {
    const state = new DtocState()
    const entry = state.register({
      sessionID: "session-1",
      callID: "call-1",
      tool: "shell",
      output: "hello\nworld",
      timestamp: 123,
    })

    expect(entry.toolKey).toBe("tk_001")
    expect(entry.characters).toBe(11)
    expect(state.register({
      sessionID: "session-1",
      callID: "call-1",
      tool: "shell",
      output: "[DTOC metadata]\nchanged",
    })).toBe(entry)
  })

  test("renders plain-text metadata instead of a JSON envelope", () => {
    const state = new DtocState()
    const entry = state.register({
      sessionID: "session-1",
      callID: "call-1",
      tool: "read",
      output: "full file contents",
    })

    expect(metadataFor(entry, "visible")).toContain("characters: 18")
    expect(metadataFor(entry, "visible")).toContain("timestamp: ")
    expect(renderToolOutput(entry)).toContain("[DTOC metadata]")
    expect(renderToolOutput(entry)).toContain("full file contents")
    expect(renderToolOutput(entry)).not.toContain('"tool_key"')
  })

  test("hides and restores by tool key", () => {
    const state = new DtocState()
    const entry = state.register({
      sessionID: "session-1",
      callID: "call-1",
      tool: "grep",
      output: "matches",
    })

    expect(state.setVisibility("session-1", [entry.toolKey], false)).toEqual(["tk_001"])
    expect(renderToolOutput(entry)).toContain("status: hidden")
    expect(renderToolOutput(entry)).toContain("restore: call manage_context with tk_001")
    expect(renderToolOutput(entry)).not.toContain("matches")

    expect(state.setVisibility("session-1", [entry.toolKey], true)).toEqual(["tk_001"])
    expect(renderToolOutput(entry)).toContain("status: visible")
    expect(renderToolOutput(entry)).toContain("matches")
  })

  test("replaces output while preserving the original for restoration", () => {
    const state = new DtocState()
    const entry = state.register({
      sessionID: "session-1",
      callID: "call-1",
      tool: "test",
      output: "42 tests passed with no failures",
    })

    expect(state.replace("session-1", { [entry.toolKey]: "All 42 tests passed. No failures." })).toEqual(["tk_001"])
    expect(renderToolOutput(entry)).toContain("status: replaced")
    expect(renderToolOutput(entry)).toContain("source: llm")
    expect(renderToolOutput(entry)).toContain("All 42 tests passed. No failures.")
    expect(renderToolOutput(entry)).not.toContain("42 tests passed with no failures")

    expect(state.setVisibility("session-1", [entry.toolKey], true)).toEqual(["tk_001"])
    expect(renderToolOutput(entry)).toContain("status: visible")
    expect(renderToolOutput(entry)).toContain("42 tests passed with no failures")
  })
})
