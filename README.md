# XBTFX MCP Trading Server

MCP server for the [XBTFX Trading API](https://console.xbtfx.com) — trade forex, metals, indices, and crypto from any AI agent that supports the [Model Context Protocol](https://modelcontextprotocol.io).

Works with Claude Code, Claude Desktop, OpenAI Codex, Cursor, Windsurf, and any other MCP-compatible client.

## Setup

1. Get an API key from [console.xbtfx.com](https://console.xbtfx.com)

2. Add to your AI tool:

### Claude Code

```bash
claude mcp add xbtfx-trading -e XBTFX_API_KEY=xbtfx_live_your_key_here -- npx @xbtfx/mcp-trading
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xbtfx-trading": {
      "command": "npx",
      "args": ["@xbtfx/mcp-trading"],
      "env": {
        "XBTFX_API_KEY": "xbtfx_live_your_key_here"
      }
    }
  }
}
```

### OpenAI Codex

```bash
codex mcp add xbtfx-trading -- npx @xbtfx/mcp-trading
```

Then set the API key in your environment before running Codex:

```bash
export XBTFX_API_KEY="xbtfx_live_your_key_here"
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "xbtfx-trading": {
      "command": "npx",
      "args": ["@xbtfx/mcp-trading"],
      "env": {
        "XBTFX_API_KEY": "xbtfx_live_your_key_here"
      }
    }
  }
}
```

## Tools

### Account & Market Data

| Tool | Description |
|------|-------------|
| `get_auth_status` | Check API key status, login, margin mode, permissions |
| `get_account` | Balance, equity, margin, P&L, leverage |
| `get_positions` | All open positions with P&L |
| `get_orders` | Pending limit/stop orders |
| `get_history` | Deal history by period or date range |
| `get_symbols` | All 400+ tradeable instruments |
| `get_symbol` | Detailed spec for one symbol (digits, volume limits, spread) |

### Trading

| Tool | Description |
|------|-------------|
| `trade` | Open a position (buy/sell) with optional SL/TP |
| `close_position` | Close a position (full or partial) |
| `modify_position` | Change SL/TP on an existing position |
| `close_by` | Close against an opposite position (hedging mode) |
| `reverse_position` | Reverse a position direction |
| `close_all` | Close all open positions |
| `close_symbol` | Close all positions for one symbol |

## Example Conversation

> **You:** What's my account balance?
>
> **AI:** *calls get_account* — Your balance is $988.00 with $888.00 free margin. Leverage is 1:1000. No open positions.

> **You:** Buy 0.01 lots of EURUSD with a 50 pip stop loss
>
> **AI:** *calls get_symbol for EURUSD, then calls trade* — Opened BUY 0.01 EURUSD at 1.15350. Set SL at 1.14850 (50 pips). Ticket #23015470.

> **You:** How's that position doing?
>
> **AI:** *calls get_positions* — EURUSD BUY 0.01 lots: opened at 1.15350, current price 1.15380, P&L: +$0.30.

## API Documentation

- [XBTFX Console](https://console.xbtfx.com) — API key management
- [XBTFX Skills Hub](https://github.com/XBTFX/xbtfx-skills-hub) — Detailed API reference
- [API Examples](https://github.com/XBTFX/xbtfx-api-examples) — Python, JavaScript, Go, curl

## License

MIT
