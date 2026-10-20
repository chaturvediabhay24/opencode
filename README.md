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

## Context utilization

Before each model request, DTOC refreshes tool-output metadata with the latest available assistant input usage for that session:

```text
context_basis: last_reported_request_input (including cache; excludes new tool results and visibility changes)
context_tokens: 80000
context_limit: 200000
context_percent: 40%
context_model: provider/model
context_message_id: msg_...
```

`context_tokens` is the latest reported input plus cache-read and cache-write tokens; it is not a sum across conversation turns. The percentage divides that count by the reporting model's configured context limit, rounded to one decimal place. Output and reasoning tokens are excluded from this input-usage metric.

These fields appear on both visible and hidden tool results, letting the LLM use them when deciding what to hide or restore. They describe the last reported request, not the exact next-request size: new messages, tool results, DTOC metadata, and visibility changes can change the next count. If the model has changed, `context_model` still identifies the model that reported the usage.

Usage fields are omitted until reported usage exists. If the model limit is unavailable, DTOC includes the token count without a limit or percentage and retries the lookup on a later request.

## Development

```sh
bun install
bun test
bun run build
```

This first version targets OpenCode 1.17.7 and newer.
