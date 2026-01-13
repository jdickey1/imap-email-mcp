# IMAP Email MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides email capabilities to Claude Code, Claude Desktop, Cursor, and other MCP-compatible AI tools. Connect to any IMAP/SMTP email provider to read, search, compose, and manage emails directly from your AI assistant.

## Quick Start

### Claude Code (CLI)

**Important:** Claude Code CLI uses `claude mcp add`, not config files.

```bash
claude mcp add imap-email -s user \
  -e IMAP_USER=you@example.com \
  -e IMAP_PASSWORD='your-app-password' \
  -e IMAP_HOST=imap.example.com \
  -- npx -y imap-email-mcp
```

> **Note:** If your password contains special shell characters (`%`, `^`, `*`, `$`, `!`, etc.), wrap it in single quotes as shown above.

> **Note:** Restart Claude Code after adding an MCP for the new tools to become available.

Verify with:
```bash
claude mcp list
claude mcp get imap-email
```

Remove with:
```bash
claude mcp remove imap-email -s user
```

### Cursor

Add new MCP server:
- **Name:** `imap-email`
- **Type:** `command`
- **Command:** `npx -y imap-email-mcp`

Then set environment variables in Cursor's MCP settings:
```
IMAP_USER=your-email@example.com
IMAP_PASSWORD=your-app-password
IMAP_HOST=imap.example.com
```

### Claude Desktop

Add to your config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "imap-email": {
      "command": "npx",
      "args": ["-y", "imap-email-mcp"],
      "env": {
        "IMAP_USER": "your-email@example.com",
        "IMAP_PASSWORD": "your-app-password",
        "IMAP_HOST": "imap.example.com"
      }
    }
  }
}
```

## Features

- **Read emails** - List and read emails from any folder
- **Search** - Search by subject, sender, or body content
- **Compose** - Create and save email drafts
- **Send** - Send emails directly via SMTP
- **Manage drafts** - List, read, update, and delete drafts
- **Delete emails** - Remove unwanted messages
- **Multi-provider support** - Works with Gmail, Outlook, Yahoo, Fastmail, and any standard IMAP provider

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `IMAP_USER` | Your email address |
| `IMAP_PASSWORD` | App password (not your main password!) |
| `IMAP_HOST` | IMAP server hostname |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAP_PORT` | `993` | IMAP port |
| `IMAP_TLS` | `true` | Use TLS |
| `SMTP_HOST` | Same as IMAP_HOST | SMTP server hostname |
| `SMTP_PORT` | `465` | SMTP port |
| `SMTP_SECURE` | `true` | Use secure SMTP |

### Provider Settings

| Provider | IMAP_HOST | SMTP_HOST | Notes |
|----------|-----------|-----------|-------|
| **Gmail** | `imap.gmail.com` | `smtp.gmail.com` | [Create App Password](https://myaccount.google.com/apppasswords) |
| **Outlook** | `outlook.office365.com` | `smtp.office365.com` | Use port 587, SMTP_SECURE=false |
| **Yahoo** | `imap.mail.yahoo.com` | `smtp.mail.yahoo.com` | Generate App Password in settings |
| **Fastmail** | `imap.fastmail.com` | `smtp.fastmail.com` | App Password from Privacy & Security |
| **iCloud** | `imap.mail.me.com` | `smtp.mail.me.com` | [Generate App Password](https://appleid.apple.com/) |

## Available Tools

| Tool | Description |
|------|-------------|
| `list_folders` | List all email folders/mailboxes |
| `list_emails` | List emails with optional filtering |
| `get_email` | Get full email content by UID |
| `search_emails` | Search by subject, sender, or body |
| `list_drafts` | List all draft emails |
| `get_draft` | Get a specific draft by UID |
| `create_draft` | Create a new email draft |
| `update_draft` | Update an existing draft |
| `send_email` | Send an email directly |
| `delete_email` | Delete an email by UID |

## Usage Examples

Once configured, use natural language:

- "Check my inbox for unread emails"
- "Search for emails from john@example.com"
- "Create a draft email to sarah@example.com about the meeting tomorrow"
- "Show me my drafts folder"

## Security Best Practices

1. **Use App Passwords** - Never use your main account password
2. **Environment Variables** - Store credentials in env vars, not in code
3. **Review Before Sending** - Use `create_draft` instead of `send_email` to review first

## Troubleshooting

**Authentication failed**
- Verify your app password is correct
- Ensure IMAP access is enabled in your email provider's settings

**Drafts folder not found**
- The server tries common names (`Drafts`, `INBOX.Drafts`, `[Gmail]/Drafts`)
- Your provider may use a different folder name

**Connection timeout**
- Check your `IMAP_HOST` is correct
- Verify port 993 is not blocked by firewall

## Alternative Installation

### Install globally
```bash
npm install -g imap-email-mcp
imap-email-mcp
```

### Clone and run
```bash
git clone https://github.com/jdickey1/imap-email-mcp.git
cd imap-email-mcp
npm install
node index.js
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [npm package](https://www.npmjs.com/package/imap-email-mcp)
- [GitHub repo](https://github.com/jdickey1/imap-email-mcp)
- [MCP Protocol](https://modelcontextprotocol.io/)
