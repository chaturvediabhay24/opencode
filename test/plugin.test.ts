import { describe, expect, test } from "bun:test"
import { DtocPlugin } from "../src/index.js"

describe("DTOC plugin hook", () => {
  test("rewrites model-bound tool output and can hide it through manage_context", async () => {
    const hooks = await DtocPlugin({} as Parameters<typeof DtocPlugin>[0])
    const transform = hooks["experimental.chat.messages.transform"]
    const system = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({} as never, system)
    expect(system.system.join("\n")).toContain("DTOC (Dynamic Tool Output Compression) is active")
    expect(system.system.join("\n")).toContain("character count")

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
  })
})
