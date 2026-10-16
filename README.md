# OpenCode DTOC plugin

Dynamic Tool Output Compression for OpenCode.

This plugin keeps full tool results in OpenCode's existing session history, but changes the copy sent to the model. Each tool result gets a plain-text metadata block at the top:

```text
[DTOC metadata]
tool_key: tk_001
tool: shell
characters: 18420
status: visible
[/DTOC metadata]
```

When a result is hidden, the model sees the metadata and a short placeholder instead of the full result. The `manage_context` tool can restore, hide, or replace results by `tool_key`.

```json
{
  "disable": ["tk_001"],
  "enable": ["tk_002"],
  "replace": {
    "tk_003": "All 42 tests passed. No failures.",
    "tk_004": "Found 3 references to authenticate() in auth.ts."
  }
}
```

`replace` maps each tool key to the text shown to the model. DTOC keeps the original output, so `enable` restores the original and clears its replacement. A replacement is marked with `status: replaced`, the original `characters` count, `replacement_characters`, and `source: llm`.

## Install

Add the package to `opencode.json`:

```json
{
  "plugin": ["opencode-dtoc"]
}
```

It is enabled by default. Options can be passed as the second item in the plugin entry:

```json
{
  "plugin": [
    [
      "opencode-dtoc",
      {
        "excludeTools": ["some_tool"],
        "enabled": true
      }
    ]
  ]
}
```

The plugin uses OpenCode's `experimental.chat.messages.transform` hook to change only model-bound messages and `experimental.chat.system.transform` to provide the DTOC operating instructions to the agent. It does not modify the stored session messages. The mapping is kept in plugin memory for the running OpenCode process; OpenCode still retains the original tool output in session history. Do not include the same tool key in more than one action in a single `manage_context` call.

## Development

```sh
bun install
bun test
bun run build
```

This first version targets OpenCode 1.17.7 and newer.
