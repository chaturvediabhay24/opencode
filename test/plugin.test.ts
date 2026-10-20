import { describe, expect, test } from "bun:test"
import { DtocPlugin } from "../src/index.js"

describe("DTOC plugin hook", () => {
  function assistant(id: string, input: number, sessionID = "session-1") {
    return {
      info: {
        id, sessionID, role: "assistant", modelID: "model-1", providerID: "provider-1",
        tokens: { input, output: 200, reasoning: 100, cache: { read: 1000, write: 500 } },
      },
      parts: [],
    }
  }

  function toolMessage(sessionID = "session-1") {
    return {
      info: { sessionID, role: "user" },
      parts: [{
        sessionID, callID: "call-1", type: "tool", tool: "shell",
        state: { status: "completed", output: "full shell output", time: { start: 1, end: 2 } },
      }],
    }
  }

  test("refreshes last reported context on visible and hidden outputs, skipping empty assistant messages", async () => {
    let lookups = 0
    const hooks = await DtocPlugin({ client: { config: { providers: async () => {
      lookups++
      return { data: { providers: [{ id: "provider-1", models: { "model-1": { limit: { context: 10000 } } } }] } }
    } } } } as never)
    const transform = hooks["experimental.chat.messages.transform"]!
    const message = toolMessage()
    const empty = assistant("msg-003", 0)
    empty.info.tokens.cache = { read: 0, write: 0 }
    // Compaction may reorder model-bound messages; choose newest ID rather than last position.
    const output = { messages: [assistant("msg-002", 2500), assistant("msg-001", 500), message, empty] }
    await transform({}, output as never)
    expect(message.parts[0].state.output).toContain("context_tokens: 4000")
    expect(message.parts[0].state.output).toContain("context_limit: 10000")
    expect(message.parts[0].state.output).toContain("context_percent: 40%")
    expect(message.parts[0].state.output).toContain("context_message_id: msg-002")
    expect(message.parts[0].state.output).toContain("context_basis: last_reported_request_input")
    await hooks.tool!.manage_context.execute({ enable: [], disable: ["tk_001"] }, { sessionID: "session-1" } as never)
    output.messages.push(assistant("msg-004", 4500))
    await transform({}, output as never)
    expect(message.parts[0].state.output).toContain("context_percent: 60%")
    expect(message.parts[0].state.output).toContain("status: hidden")
    expect(message.parts[0].state.output).not.toContain("full shell output")
    expect(lookups).toBe(1)
    await hooks.tool!.manage_context.execute(
      { replace: { tk_001: "Shell completed successfully." } },
      { sessionID: "session-1" } as never,
    )
    await transform({}, output as never)
    expect(message.parts[0].state.output).toContain("context_percent: 60%")
    expect(message.parts[0].state.output).toContain("status: replaced")
    expect(message.parts[0].state.output).toContain("source: llm")
    expect(message.parts[0].state.output).toContain("Shell completed successfully.")
    expect(message.parts[0].state.output).not.toContain("full shell output")
    const other = toolMessage("session-2")
    await transform({}, { messages: [other] } as never)
    expect(other.parts[0].state.output).not.toContain("context_tokens")
    await transform({}, { messages: [message] } as never)
    expect(message.parts[0].state.output).not.toContain("context_tokens")
  })

  test("keeps token counts when provider lookup fails and retries on the next request", async () => {
    let lookups = 0
    const hooks = await DtocPlugin({ client: { config: { providers: async () => {
      lookups++
      if (lookups === 1) throw new Error("unavailable")
      return { data: { providers: [{ id: "provider-1", models: { "model-1": { limit: { context: 10000 } } } }] } }
    } } } } as never)
    const message = toolMessage()
    const output = { messages: [assistant("msg-001", 2500), message] }
    const transform = hooks["experimental.chat.messages.transform"]!
    await transform({}, output as never)
    expect(message.parts[0].state.output).toContain("context_tokens: 4000")
    expect(message.parts[0].state.output).not.toContain("context_percent")
    await transform({}, output as never)
    expect(message.parts[0].state.output).toContain("context_percent: 40%")
  })

  test("rewrites model-bound tool output and can hide it through manage_context", async () => {
    const hooks = await DtocPlugin({} as Parameters<typeof DtocPlugin>[0])
    const transform = hooks["experimental.chat.messages.transform"]
    const system = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({} as never, system)
    expect(system.system.join("\n")).toContain("DTOC (Dynamic Tool Output Compression) is active")
    expect(system.system.join("\n")).toContain("character count")
    expect(system.system.join("\n")).toContain("tool_key-to-text map")
    expect(system.system.join("\n")).toContain("batch multiple visibility changes")
    expect(system.system.join("\n")).toContain("not a strict requirement")

    const part = {
      sessionID: "session-1",
      callID: "call-1",
      type: "tool" as const,
      tool: "shell",
      state: {
        status: "completed" as const,
        output: "full shell output",
        time: { start: 1, end: 2 },
      },
    }
    const output = {
      messages: [{ info: { sessionID: "session-1" }, parts: [part] }],
    }

    await transform?.({}, output as never)
    expect(part.state.output).toContain("tool_key: tk_001")
    expect(part.state.output).toContain("characters: 17")
    expect(part.state.output).toContain("full shell output")

    await hooks.tool?.manage_context.execute({ disable: ["tk_001"] } as never, { sessionID: "session-1" } as never)
    await transform?.({}, output as never)
    expect(part.state.output).toContain("status: hidden")
    expect(part.state.output).not.toContain("full shell output")

    await hooks.tool?.manage_context.execute({ enable: ["tk_001"] } as never, { sessionID: "session-1" } as never)
    await transform?.({}, output as never)
    expect(part.state.output).toContain("status: visible")
    expect(part.state.output).toContain("full shell output")

    await hooks.tool?.manage_context.execute({ replace: { "tk_001": "Shell completed successfully." } } as never, { sessionID: "session-1" } as never)
    await transform?.({}, output as never)
    expect(part.state.output).toContain("status: replaced")
    expect(part.state.output).toContain("source: llm")
    expect(part.state.output).toContain("Shell completed successfully.")
    expect(part.state.output).not.toContain("full shell output")

    const conflict = await hooks.tool?.manage_context.execute({
      enable: ["tk_001"],
      replace: { "tk_001": "conflicting text" },
    } as never, { sessionID: "session-1" } as never)
    expect(conflict.title).toContain("No context changes applied")
  })
})
