import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { DtocState, metadataFor, renderToolOutput, type ContextUsage, type DtocOptions } from "./state.js"

type MessagesTransform = NonNullable<Hooks["experimental.chat.messages.transform"]>
type TransformOutput = Parameters<MessagesTransform>[1]

const MANAGE_CONTEXT_TOOL = "manage_context"

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

export const DtocPlugin: Plugin = async (input, rawOptions) => {
  const state = new DtocState(optionsFromUnknown(rawOptions))
  const contextLimits = new Map<string, number | undefined>()

  return {
    tool: {
      [MANAGE_CONTEXT_TOOL]: tool({
        description:
          "Control which previous tool outputs remain visible to the model. Use tool_key values from DTOC metadata. " +
          "Set enable or disable to an array; pass an empty array when unused.",
        args: {
          enable: tool.schema.array(tool.schema.string()).describe("Tool keys whose full output should be restored."),
          disable: tool.schema.array(tool.schema.string()).describe("Tool keys whose output should be hidden."),
        },
        async execute(args, context) {
          const enabled = state.setVisibility(context.sessionID, args.enable, true)
          const disabled = state.setVisibility(context.sessionID, args.disable, false)
          const entries = state.list(context.sessionID)

          return {
            title: `${disabled.length} hidden, ${enabled.length} restored`,
            output: [
              enabled.length > 0 ? `Restored: ${enabled.join(", ")}` : "Restored: none",
              disabled.length > 0 ? `Hidden: ${disabled.join(", ")}` : "Hidden: none",
              `Tracked tool outputs: ${entries.length}`,
              "The next model request will use the updated visibility.",
            ].join("\n"),
            metadata: {
              enabled,
              disabled,
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
  }
}

export { DtocState, metadataFor, renderToolOutput }
export type { ContextUsage, DtocEntry, DtocOptions } from "./state.js"
export default DtocPlugin
