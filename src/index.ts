import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { DtocState, metadataFor, renderToolOutput, type ContextUsage, type DtocOptions } from "./state.js"

type MessagesTransform = NonNullable<Hooks["experimental.chat.messages.transform"]>
type TransformOutput = Parameters<MessagesTransform>[1]

const MANAGE_CONTEXT_TOOL = "manage_context"

const DTOC_AGENT_INSTRUCTIONS = [
  "DTOC (Dynamic Tool Output Compression) is active for this session.",
  "",
  "When DTOC is active:",
  "- Completed tool outputs include a plain-text DTOC metadata block with a tool_key, tool name, character count, timestamp, and visibility status.",
  "- You have access to the manage_context tool to hide or restore tool outputs by their tool_key.",
  "- You can replace a tool output with a concise summary by passing a tool_key-to-text map in replace; the original remains available for restoration.",
  "- Hidden outputs are replaced with compact placeholders to save context space.",
  "- enable restores the original output and clears any replacement for that tool_key.",
  "- You can restore any hidden output when needed; the original content remains preserved in session history.",
  "",
  "DTOC strategy:",
  "- Gather related context efficiently, then hide outputs that are no longer relevant to the current reasoning step.",
  "- When you re-read a file after editing it, hide the older stale output so only the current version remains visible.",
  "- Hide large outputs that contain information you have already extracted or no longer need.",
  "- Replace large outputs with concise summaries when the important facts can be preserved accurately.",
  "- Before producing a final response, hide irrelevant outputs so the active context contains only evidence needed for an accurate answer.",
  "- Restore a hidden output whenever you need to revisit its exact contents.",
  "",
  "Reminder, when practical (not a strict requirement): batch multiple visibility changes into one manage_context call instead of making separate calls for individual tool outputs.",
  "",
  "For manage_context, provide enable and/or disable arrays of tool_key values and/or a replace object mapping tool_key to replacement text. Each field may be omitted when unused.",
].join("\n")

function optionsFromUnknown(options: Record<string, unknown> | undefined): DtocOptions {
  return {
    enabled: options?.enabled !== false,
    excludeTools: Array.isArray(options?.excludeTools)
      ? options.excludeTools.filter((item): item is string => typeof item === "string")
      : undefined,
  }
}

function sessionIDFromMessages(output: TransformOutput) {
  return output.messages[0]?.info.sessionID
}

function latestAssistantUsage(output: TransformOutput, sessionID: string) {
  let assistant: Extract<TransformOutput["messages"][number]["info"], { role: "assistant" }> | undefined
  for (const { info } of output.messages) {
    if (info.role !== "assistant" || info.sessionID !== sessionID || info.error) continue
    const count = info.tokens.input + info.tokens.cache.read + info.tokens.cache.write
    if (!Number.isFinite(count) || count <= 0) continue
    if (!assistant || info.id > assistant.id) assistant = info
  }
  if (!assistant) return
  const tokens = assistant.tokens
  const count = tokens.input + tokens.cache.read + tokens.cache.write
  return {
    count,
    modelID: assistant.modelID,
    providerID: assistant.providerID,
    messageID: assistant.id,
  }
}

async function modelContextLimit(client: Parameters<Plugin>[0]["client"], providerID: string, modelID: string) {
  try {
    const response = await client.config.providers()
    const limit = response.data?.providers.find((provider) => provider.id === providerID)?.models[modelID]?.limit.context
    return limit && Number.isFinite(limit) && limit > 0 ? limit : undefined
  } catch {
    // Usage and DTOC still work if the provider catalogue is unavailable.
    return undefined
  }
}

function transformMessages(state: DtocState, output: TransformOutput, sessionID: string) {
  for (const message of output.messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || part.state.status !== "completed") continue
      if (state.isExcluded(part.tool) || part.tool === MANAGE_CONTEXT_TOOL) continue

      const entry = state.register({
        sessionID: part.sessionID,
        callID: part.callID,
        tool: part.tool,
        output: part.state.output,
        timestamp: part.state.time.end,
      })
      part.state.output = renderToolOutput(entry, state.contextUsage(sessionID))
    }
  }
}

function conflictingKeys(args: { enable?: string[]; disable?: string[]; replace?: Record<string, string> }) {
  const actions = new Map<string, string[]>()
  const add = (keys: string[] | undefined, action: string) => {
    for (const key of keys ?? []) actions.set(key, [...(actions.get(key) ?? []), action])
  }
  add(args.enable, "enable")
  add(args.disable, "disable")
  add(Object.keys(args.replace ?? {}), "replace")
  return [...actions.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([key, values]) => `${key} (${values.join(", ")})`)
}

export const DtocPlugin: Plugin = async (input, rawOptions) => {
  const state = new DtocState(optionsFromUnknown(rawOptions))
  const contextLimits = new Map<string, number | undefined>()

  return {
    tool: {
      [MANAGE_CONTEXT_TOOL]: tool({
        description:
          "Control which previous tool outputs remain visible to the model. Use tool_key values from DTOC metadata. " +
          "Set enable and/or disable to arrays, and replace to a tool_key-to-text object. " +
          "Each field may be omitted when unused. Batch related changes when practical. " +
          'Example: {"disable":["tk_001"],"enable":["tk_002"],"replace":{"tk_003":"All 42 tests passed. No failures.","tk_004":"Found 3 references to authenticate() in auth.ts."}}. ' +
          "Use only one action per tool key in a single call.",
        args: {
          enable: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Tool keys whose full output should be restored."),
          disable: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Tool keys whose output should be hidden."),
          replace: tool.schema
            .record(tool.schema.string(), tool.schema.string())
            .optional()
            .describe("Map each tool key to concise replacement text shown instead of its original output."),
        },
        async execute(args, context) {
          // Models often omit the unused side of this command. Treat a missing
          // array as empty instead of failing inside DtocState.setVisibility.
          const conflicts = conflictingKeys(args)
          if (conflicts.length > 0) {
            return {
              title: "No context changes applied",
              output: [
                "The same tool key was included in multiple actions:",
                ...conflicts.map((item) => `- ${item}`),
                "Use only one action per tool key in a manage_context call.",
              ].join("\n"),
              metadata: { conflicts },
            }
          }

          const enabled = state.setVisibility(context.sessionID, args.enable ?? [], true)
          const disabled = state.setVisibility(context.sessionID, args.disable ?? [], false)
          const replaced = state.replace(context.sessionID, args.replace ?? {})
          const entries = state.list(context.sessionID)

          return {
            title: `${disabled.length} hidden, ${enabled.length} restored`,
            output: [
              enabled.length > 0 ? `Restored: ${enabled.join(", ")}` : "Restored: none",
              disabled.length > 0 ? `Hidden: ${disabled.join(", ")}` : "Hidden: none",
              replaced.length > 0 ? `Replaced: ${replaced.join(", ")}` : "Replaced: none",
              `Tracked tool outputs: ${entries.length}`,
              "The next model request will use the updated visibility.",
            ].join("\n"),
            metadata: {
              enabled,
              disabled,
              replaced,
              tracked: entries.length,
            },
          }
        },
      }),
    },
    "experimental.chat.messages.transform": async (_hookInput, output) => {
      const sessionID = sessionIDFromMessages(output)
      if (!state.isEnabled() || !sessionID) return

      const usage = latestAssistantUsage(output, sessionID)
      if (usage) {
        const key = `${usage.providerID}/${usage.modelID}`
        if (!contextLimits.has(key)) {
          const limit = await modelContextLimit(input.client, usage.providerID, usage.modelID)
          if (limit !== undefined) contextLimits.set(key, limit)
        }
        const limit = contextLimits.get(key)
        const contextUsage: ContextUsage = {
          tokens: usage.count,
          limit,
          percent: limit ? Math.round((usage.count / limit) * 1000) / 10 : undefined,
          model: key,
          messageID: usage.messageID,
        }
        state.setContextUsage(sessionID, contextUsage)
      } else {
        state.setContextUsage(sessionID, undefined)
      }
      transformMessages(state, output, sessionID)
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (!state.isEnabled()) return
      output.system.push(DTOC_AGENT_INSTRUCTIONS)
    },
  }
}

export { DtocState, metadataFor, renderToolOutput }
export type { ContextUsage, DtocEntry, DtocOptions } from "./state.js"
export default DtocPlugin
