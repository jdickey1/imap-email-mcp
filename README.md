# IMAP Email MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides email capabilities to Claude Code and other MCP-compatible AI tools. Connect to any IMAP/SMTP email provider to read, search, compose, and manage emails directly from your AI assistant.

## Features

- **Read emails** - List and read emails from any folder
- **Search** - Search by subject, sender, or body content
- **Compose** - Create and save email drafts
- **Send** - Send emails directly via SMTP
- **Manage drafts** - List, read, update, and delete drafts
- **Delete emails** - Remove unwanted messages
- **Multi-provider support** - Works with Gmail, Outlook, Yahoo, Fastmail, and any standard IMAP provider

## Installation

### Option 1: Clone and run locally

```bash
git clone https://github.com/jdickey1/imap-email-mcp.git
cd imap-email-mcp
npm install
```

### Option 2: Install globally via npm

```bash
npm install -g imap-email-mcp
```

## Configuration

### Environment Variables

Create a `.env` file or set these environment variables:

```bash
# Required
IMAP_USER=your-email@example.com
IMAP_PASSWORD=your-app-password
IMAP_HOST=imap.example.com

# Optional (with defaults)
IMAP_PORT=993
IMAP_TLS=true
IMAP_AUTH_TIMEOUT=10000
IMAP_TLS_REJECT_UNAUTHORIZED=true

# SMTP (defaults to IMAP settings if not specified)
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-app-password
```

### Provider-Specific Settings

<details>
<summary><strong>Gmail</strong></summary>

1. Enable 2-Factor Authentication on your Google account
2. Generate an [App Password](https://myaccount.google.com/apppasswords)
3. Use these settings:

```bash
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=your-16-char-app-password
IMAP_HOST=imap.gmail.com
SMTP_HOST=smtp.gmail.com
```

</details>

<details>
<summary><strong>Outlook / Microsoft 365</strong></summary>

1. Enable 2-Factor Authentication
2. Generate an App Password in your Microsoft account security settings
3. Use these settings:

```bash
IMAP_USER=your-email@outlook.com
IMAP_PASSWORD=your-app-password
IMAP_HOST=outlook.office365.com
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
```

</details>

<details>
<summary><strong>Yahoo Mail</strong></summary>

1. Enable 2-Factor Authentication
2. Generate an App Password
3. Use these settings:

```bash
IMAP_USER=your-email@yahoo.com
IMAP_PASSWORD=your-app-password
IMAP_HOST=imap.mail.yahoo.com
SMTP_HOST=smtp.mail.yahoo.com
```

</details>

<details>
<summary><strong>Fastmail</strong></summary>

1. Generate an App Password in Settings > Privacy & Security
2. Use these settings:

```bash
IMAP_USER=your-email@fastmail.com
IMAP_PASSWORD=your-app-password
IMAP_HOST=imap.fastmail.com
SMTP_HOST=smtp.fastmail.com
```

</details>

<details>
<summary><strong>Custom/Self-hosted</strong></summary>

Use your mail server's IMAP and SMTP settings:

```bash
IMAP_USER=you@yourdomain.com
IMAP_PASSWORD=your-password
IMAP_HOST=mail.yourdomain.com
SMTP_HOST=mail.yourdomain.com
```

</details>

## Adding to Claude Code

### Method 1: Using the CLI

```bash
claude mcp add imap-email -- node /path/to/imap-email-mcp/index.js
```

With environment variables:

```bash
claude mcp add imap-email \
  -e IMAP_USER=your-email@example.com \
  -e IMAP_PASSWORD=your-app-password \
  -e IMAP_HOST=imap.example.com \
  -- node /path/to/imap-email-mcp/index.js
```

### Method 2: Manual configuration

Add to your `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "imap-email": {
      "command": "node",
      "args": ["/path/to/imap-email-mcp/index.js"],
      "env": {
        "IMAP_USER": "your-email@example.com",
        "IMAP_PASSWORD": "your-app-password",
        "IMAP_HOST": "imap.example.com"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_folders` | List all email folders/mailboxes |
| `list_emails` | List emails with optional filtering (folder, limit, unread only, since date) |
| `get_email` | Get full email content by UID |
| `search_emails` | Search emails by subject, sender, or body text |
| `list_drafts` | List all draft emails |
| `get_draft` | Get a specific draft by UID |
| `create_draft` | Create a new email draft |
| `update_draft` | Update an existing draft |
| `send_email` | Send an email directly |
| `delete_email` | Delete an email by UID |

## Usage Examples

Once configured, you can use natural language with Claude Code:

- "Check my inbox for unread emails"
- "Search for emails from john@example.com"
- "Create a draft email to sarah@example.com about the meeting tomorrow"
- "Show me my drafts folder"
- "Delete the email with UID 12345"

## Security Best Practices

1. **Use App Passwords** - Never use your main account password. Generate app-specific passwords.
2. **Environment Variables** - Store credentials in environment variables, not in code.
3. **Review Before Sending** - Consider using `create_draft` instead of `send_email` to review messages before sending.
4. **Limit Permissions** - If your email provider supports it, limit the app password's scope.

## Troubleshooting

### "Authentication failed"
- Verify your app password is correct
- Ensure IMAP access is enabled in your email provider's settings
- Check if 2FA is required for app passwords

### "Drafts folder not found"
The server automatically tries common folder names (`Drafts`, `INBOX.Drafts`, `[Gmail]/Drafts`). If your provider uses a different name, you may need to modify the `findDraftsFolder` function.

### "Connection timeout"
- Check your `IMAP_HOST` is correct
- Verify port 993 (or your configured port) is not blocked
- Try increasing `IMAP_AUTH_TIMEOUT`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.
