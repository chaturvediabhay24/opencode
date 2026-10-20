export type DtocEntry = {
  sessionID: string
  callID: string
  toolKey: string
  tool: string
  characters: number
  timestamp: number
  visible: boolean
  originalOutput: string
  replacementOutput?: string
}

export type ContextUsage = {
  tokens: number
  limit?: number
  percent?: number
  model?: string
  messageID?: string
}

export type DtocOptions = {
  enabled?: boolean
  excludeTools?: string[]
}

export const DTOC_METADATA_START = "[DTOC metadata]"
export const DTOC_METADATA_END = "[/DTOC metadata]"

type SessionState = {
  nextKey: number
  entriesByCallID: Map<string, DtocEntry>
  entriesByToolKey: Map<string, DtocEntry>
  contextUsage?: ContextUsage
}

function createSession(): SessionState {
  return {
    nextKey: 1,
    entriesByCallID: new Map(),
    entriesByToolKey: new Map(),
  }
}

export function metadataFor(entry: DtocEntry, status: "visible" | "hidden" | "replaced", contextUsage?: ContextUsage) {
  const restore = status === "hidden" ? `\nrestore: call manage_context with ${entry.toolKey}` : ""
  const replacement = status === "replaced"
    ? `\nreplacement_characters: ${entry.replacementOutput?.length ?? 0}\nsource: llm`
    : ""
  const context = contextUsage
    ? [
        "context_basis: last_reported_request_input (including cache; excludes new tool results and visibility changes)",
        `context_tokens: ${contextUsage.tokens}`,
        ...(contextUsage.limit ? [`context_limit: ${contextUsage.limit}`] : []),
        ...(contextUsage.percent !== undefined ? [`context_percent: ${contextUsage.percent}%`] : []),
        ...(contextUsage.model ? [`context_model: ${contextUsage.model}`] : []),
        ...(contextUsage.messageID ? [`context_message_id: ${contextUsage.messageID}`] : []),
      ]
    : []
  return [
    DTOC_METADATA_START,
    `tool_key: ${entry.toolKey}`,
    `tool: ${entry.tool}`,
    `characters: ${entry.characters}`,
    `timestamp: ${entry.timestamp}`,
    ...context,
    `status: ${status}${restore}${replacement}`,
    DTOC_METADATA_END,
  ].join("\n")
}

export function renderToolOutput(entry: DtocEntry, contextUsage?: ContextUsage) {
  const status = !entry.visible ? "hidden" : entry.replacementOutput !== undefined ? "replaced" : "visible"
  const metadata = metadataFor(entry, status, contextUsage)
  if (!entry.visible) return `${metadata}\n\n[Full tool output hidden by DTOC.]`
  return `${metadata}\n\n${entry.replacementOutput ?? entry.originalOutput}`
}

export class DtocState {
  private readonly sessions = new Map<string, SessionState>()
  private readonly options: DtocOptions & { enabled: boolean }

  constructor(options: DtocOptions = {}) {
    this.options = {
      ...options,
      enabled: options.enabled ?? true,
    }
  }

  isEnabled() {
    return this.options.enabled
  }

  isExcluded(tool: string) {
    return this.options.excludeTools?.includes(tool) ?? false
  }

  setContextUsage(sessionID: string, usage: ContextUsage | undefined) {
    this.session(sessionID).contextUsage = usage
  }

  contextUsage(sessionID: string) {
    return this.sessions.get(sessionID)?.contextUsage
  }

  private session(sessionID: string) {
    let state = this.sessions.get(sessionID)
    if (!state) {
      state = createSession()
      this.sessions.set(sessionID, state)
    }
    return state
  }

  register(input: {
    sessionID: string
    callID: string
    tool: string
    output: string
    timestamp?: number
  }) {
    const state = this.session(input.sessionID)
    const existing = state.entriesByCallID.get(input.callID)
    if (existing) {
      // The transform hook can run more than once over the same in-memory message.
      // Do not count our own metadata prefix as part of the original output.
      if (!input.output.startsWith(DTOC_METADATA_START)) {
        existing.originalOutput = input.output
        existing.characters = input.output.length
      }
      return existing
    }

    const toolKey = `tk_${String(state.nextKey++).padStart(3, "0")}`
    const entry: DtocEntry = {
      sessionID: input.sessionID,
      callID: input.callID,
      toolKey,
      tool: input.tool,
      characters: input.output.length,
      timestamp: input.timestamp ?? Date.now(),
      visible: true,
      originalOutput: input.output,
    }
    state.entriesByCallID.set(input.callID, entry)
    state.entriesByToolKey.set(toolKey, entry)
    return entry
  }

  setVisibility(sessionID: string, toolKeys: string[], visible: boolean) {
    const state = this.sessions.get(sessionID)
    if (!state) return []

    const changed: string[] = []
    for (const toolKey of toolKeys) {
      const entry = state.entriesByToolKey.get(toolKey)
      if (!entry) continue
      if (visible && entry.visible && entry.replacementOutput === undefined) continue
      if (!visible && !entry.visible) continue
      entry.visible = visible
      if (visible) entry.replacementOutput = undefined
      changed.push(toolKey)
    }
    return changed
  }

  replace(sessionID: string, replacements: Record<string, string>) {
    const state = this.sessions.get(sessionID)
    if (!state) return []

    const changed: string[] = []
    for (const [toolKey, replacementOutput] of Object.entries(replacements)) {
      const entry = state.entriesByToolKey.get(toolKey)
      if (!entry) continue
      if (entry.replacementOutput === replacementOutput && entry.visible) continue
      entry.replacementOutput = replacementOutput
      entry.visible = true
      changed.push(toolKey)
    }
    return changed
  }

  list(sessionID: string) {
    return [...(this.sessions.get(sessionID)?.entriesByToolKey.values() ?? [])]
  }
}
