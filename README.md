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

When a result is hidden, the model sees the metadata and a short placeholder instead of the full result. The `manage_context` tool can restore or hide results by `tool_key`.

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

The plugin uses OpenCode's `experimental.chat.messages.transform` hook, so it does not modify the stored session messages. The mapping is kept in plugin memory for the running OpenCode process; OpenCode still retains the original tool output in session history.

## Development

```sh
bun install
bun test
bun run build
```

This first version targets OpenCode 1.17.7 and newer.
