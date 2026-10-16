import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { DtocState, metadataFor, renderToolOutput, type DtocOptions } from "./state.js"

type MessagesTransform = NonNullable<Hooks["experimental.chat.messages.transform"]>
type TransformOutput = Parameters<MessagesTransform>[1]

const MANAGE_CONTEXT_TOOL = "manage_context"

const DTOC_AGENT_INSTRUCTIONS = [
  "DTOC (Dynamic Tool Output Compression) is active for this session.",
  "",
  "When DTOC is active:",
  "- Completed tool outputs include a plain-text DTOC metadata block with a tool_key, tool name, character count, timestamp, and visibility status.",
  "- You have access to the manage_context tool to hide or restore tool outputs by their tool_key.",
  "- Hidden outputs are replaced with compact placeholders to save context space.",
  "- You can restore any hidden output when needed; the original content remains preserved in session history.",
  "",
  "DTOC strategy:",
  "- Gather related context efficiently, then hide outputs that are no longer relevant to the current reasoning step.",
  "- When you re-read a file after editing it, hide the older stale output so only the current version remains visible.",
  "- Hide large outputs that contain information you have already extracted or no longer need.",
  "- Before producing a final response, hide irrelevant outputs so the active context contains only evidence needed for an accurate answer.",
  "- Restore a hidden output whenever you need to revisit its exact contents.",
  "",
  "Reminder, when practical (not a strict requirement): batch multiple visibility changes into one manage_context call instead of making separate calls for individual tool outputs.",
  "",
  "For manage_context, provide enable and/or disable arrays of tool_key values. Either array may be omitted when unused.",
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

function transformMessages(state: DtocState, output: TransformOutput) {
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
      part.state.output = renderToolOutput(entry)
    }
  }
}

export const DtocPlugin: Plugin = async (_input, rawOptions) => {
  const state = new DtocState(optionsFromUnknown(rawOptions))

  return {
    tool: {
      [MANAGE_CONTEXT_TOOL]: tool({
        description:
          "Control which previous tool outputs remain visible to the model. Use tool_key values from DTOC metadata. " +
          "Set enable or disable to an array; either field may be omitted when unused.",
        args: {
          enable: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Tool keys whose full output should be restored."),
          disable: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Tool keys whose output should be hidden."),
        },
        async execute(args, context) {
          // Models often omit the unused side of this command. Treat a missing
          // array as empty instead of failing inside DtocState.setVisibility.
          const enabled = state.setVisibility(context.sessionID, args.enable ?? [], true)
          const disabled = state.setVisibility(context.sessionID, args.disable ?? [], false)
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
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!state.isEnabled() || !sessionIDFromMessages(output)) return
      transformMessages(state, output)
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (!state.isEnabled()) return
      output.system.push(DTOC_AGENT_INSTRUCTIONS)
    },
  }
}

export { DtocState, metadataFor, renderToolOutput }
export type { DtocEntry, DtocOptions } from "./state.js"
export default DtocPlugin
