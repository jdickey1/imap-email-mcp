# IMAP Email MCP Server (extended fork)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives Claude Desktop, Claude Code, Cursor, and other MCP-compatible AI tools access to your email over IMAP/SMTP: read, search, organize, reply, attach files, and send.

This is a fork of [jdickey1/imap-email-mcp](https://github.com/jdickey1/imap-email-mcp) with extra features, safety guardrails, and a setup guide for **Proton Mail Bridge**. See [CHANGELOG.md](CHANGELOG.md) for everything that's different.

## What this fork adds

- **Attachments**: send files, and save attachments from emails to your Downloads folder
- **Real replies**: `reply_email` keeps the conversation threaded, quotes the original, supports reply-all, and can send now or save as a draft
- **Send a saved draft** exactly as reviewed (`send_draft`), and reply drafts stay threaded
- **Organize**: mark read/unread, star/unstar, move or archive, several emails at once
- **Better search**: dates, unread, starred, has-attachment, recipient, search every folder at once, with one-line previews
- **Your name and signature**: a display name for the From line and an automatic signature from a text file
- **Safer by default**: delete goes to Trash, strict email-ID checks, sensitive files can't be attached, downloads stay in Downloads
- **Password in Windows Credential Manager** instead of plain text in your config (optional)
- **Up-to-date dependencies**: nodemailer 10 fixes 22 published security advisories in the version the original used

## Requirements

- [Node.js](https://nodejs.org/) **20 or newer** (`node --version` to check)
- An email account with IMAP access, and an **app password** (not your main password) for providers that require one

## Quick start (Claude Desktop)

1. **Download and install** (with [Git](https://git-scm.com/)):
   ```bash
   git clone https://github.com/aylacullen/imap-email-mcp.git
   cd imap-email-mcp
   npm install
   ```
   Note the full path to the folder, e.g. `C:\Users\you\imap-email-mcp` or `/Users/you/imap-email-mcp`.

2. **Open your Claude Desktop config:** Claude Desktop → **Settings → Developer → Edit Config**. (This opens the right file even if it isn't in the usual place.)

3. **Add the server** inside `"mcpServers"` (create that section if it doesn't exist). Use the full path to `index.js`; on Windows, double every backslash:
   ```json
   {
     "mcpServers": {
       "imap-email": {
         "command": "node",
         "args": ["C:\\Users\\you\\imap-email-mcp\\index.js"],
         "env": {
           "IMAP_USER": "you@example.com",
           "IMAP_PASSWORD": "your-app-password",
           "IMAP_HOST": "imap.example.com",
           "SMTP_HOST": "smtp.example.com",
           "FROM_NAME": "Your Name"
         }
       }
     }
   }
   ```
   On Windows you can keep the password out of this file entirely; see [Keeping your password out of the config](#keeping-your-password-out-of-the-config-windows).

4. **Optional signature:** copy `signature.example.txt` to `signature.txt` (same folder) and edit it.

5. **Fully quit and reopen Claude Desktop** (including from the system tray). Settings are only read at startup.

Then ask Claude things like *"What's new in my inbox?"* or *"Draft a reply to that email saying I'm available Thursday."*

### Claude Code (CLI)

```bash
claude mcp add imap-email -s user \
  -e IMAP_USER=you@example.com \
  -e IMAP_PASSWORD='your-app-password' \
  -e IMAP_HOST=imap.example.com \
  -e SMTP_HOST=smtp.example.com \
  -- node /full/path/to/imap-email-mcp/index.js
```

Wrap the password in single quotes if it contains `%`, `^`, `*`, `$`, `!` or similar characters. Restart Claude Code afterwards. Check with `claude mcp get imap-email`; remove with `claude mcp remove imap-email -s user`.

### Cursor

Add an MCP server named `imap-email`, type `command`, command `node /full/path/to/imap-email-mcp/index.js`, and set the same environment variables as above in Cursor's MCP settings.

### Without cloning (npx from GitHub)

You can also point the command at this repo directly, without cloning:
```json
"command": "npx",
"args": ["-y", "github:aylacullen/imap-email-mcp"]
```
This always runs the latest version of this repo. If you use a signature, set `SIGNATURE_FILE` to a full path (npx keeps the code in a temporary cache folder). Note: `npx -y imap-email-mcp` (without `github:`) installs the **original** package from npm, not this fork.

## Configuration

All settings go in the `env` block of your MCP config.

### Required

| Setting | Description |
|---------|-------------|
| `IMAP_USER` | Your email address |
| `IMAP_PASSWORD` | Your app password. Or, on Windows, use `IMAP_PASSWORD_CREDENTIAL` instead (below) |
| `IMAP_HOST` | IMAP server hostname |

### Connection (optional)

| Setting | Default | Description |
|---------|---------|-------------|
| `IMAP_PORT` | `993` | IMAP port |
| `IMAP_TLS` | `true` | Encrypt the IMAP connection from the start (SSL/TLS) |
| `IMAP_TLS_REJECT_UNAUTHORIZED` | `true` | Check the server's certificate. Only set `false` if you understand the risk |
| `IMAP_AUTH_TIMEOUT` | `10000` | Login timeout in ms |
| `SMTP_HOST` | same as `IMAP_HOST` | SMTP server hostname |
| `SMTP_PORT` | `465` | SMTP port |
| `SMTP_SECURE` | `true` | Encrypt SMTP from the start (port 465). Set `false` for STARTTLS ports like 587 |
| `SMTP_REQUIRE_TLS` | `false` | With `SMTP_SECURE=false`, refuse to send unless the connection upgrades to TLS. Recommended `true` |
| `SMTP_USER` / `SMTP_PASSWORD` | same as IMAP | Only if SMTP uses different login details |
| `NODE_EXTRA_CA_CERTS` | | Path to an extra certificate to trust (needed for Proton Mail Bridge, see below) |

### Features (optional)

| Setting | Default | Description |
|---------|---------|-------------|
| `FROM_NAME` | (none) | Name shown as the sender, e.g. `Jane Doe` → `Jane Doe <you@example.com>`. Keep it under ~18 characters so inbox lists don't cut it off |
| `IMAP_PASSWORD_CREDENTIAL` | (none) | **Windows only.** Name of a saved Windows Credential Manager entry holding your password (see below) |
| `SIGNATURE_FILE` | `signature.txt` next to `index.js` | Text file whose contents are added to the end of new emails, drafts and replies. Edits apply immediately, no restart |
| `ATTACHMENT_DIR` | `~/Downloads/Email Attachments` | Where `download_attachment` saves files (must be inside Downloads, or this folder) |
| `ATTACHMENT_BLOCK_DIRS` | (none) | Extra folders that may never be attached, separated by `;` |

**Restart your MCP client after changing any setting.** (Except the signature file, which is re-read every time.)

### Provider settings

| Provider | IMAP_HOST | SMTP_HOST | Notes |
|----------|-----------|-----------|-------|
| **Gmail** | `imap.gmail.com` | `smtp.gmail.com` | [Create an App Password](https://myaccount.google.com/apppasswords) (needs 2-Step Verification) |
| **Outlook** | `outlook.office365.com` | `smtp.office365.com` | `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true` |
| **Yahoo** | `imap.mail.yahoo.com` | `smtp.mail.yahoo.com` | Generate an App Password in account security settings |
| **Fastmail** | `imap.fastmail.com` | `smtp.fastmail.com` | App Password from Privacy & Security |
| **iCloud** | `imap.mail.me.com` | `smtp.mail.me.com` | `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true`; [App Password](https://appleid.apple.com/) |
| **Proton Mail** | `127.0.0.1` | `127.0.0.1` | Requires Proton Mail Bridge, see below |

## Proton Mail (via Proton Mail Bridge)

Proton Mail works through [Proton Mail Bridge](https://proton.me/mail/bridge), which runs on your computer and provides IMAP/SMTP locally. Bridge must be running whenever you use the email tools.

1. **In Bridge → Settings → Advanced → Connection mode**, set **both IMAP and SMTP to SSL**.
   (STARTTLS mode is not supported for IMAP: the underlying `imap` library crashes during the STARTTLS upgrade on current Node versions.)
2. **Export Bridge's certificate:** Bridge → Settings → Advanced → **Export TLS certificates**. Save them to a folder you'll keep, then **delete the exported `key.pem`** (it's Bridge's private key; you only need `cert.pem`).
3. **Get your Bridge password and ports:** in Bridge, open your account's mailbox details. The Bridge password is *not* your Proton password. Default ports are IMAP `1143`, SMTP `1025`.
4. Config:
   ```json
   "env": {
     "IMAP_USER": "you@yourdomain.com",
     "IMAP_PASSWORD": "your-bridge-password",
     "IMAP_HOST": "127.0.0.1",
     "IMAP_PORT": "1143",
     "IMAP_TLS": "true",
     "SMTP_HOST": "127.0.0.1",
     "SMTP_PORT": "1025",
     "SMTP_SECURE": "true",
     "NODE_EXTRA_CA_CERTS": "C:\\path\\to\\cert.pem",
     "FROM_NAME": "Your Name"
   }
   ```

**Proton notes**
- **Sender name:** emails sent directly use `FROM_NAME`. **Drafts** saved to Proton take your Proton display name instead (Proton → Settings → Identity and addresses), so set both to the same name.
- **Reply drafts:** Proton strips threading headers from saved drafts. This server remembers them locally (`draft-threading.json`), so a reply draft sent with `send_draft` still lands in the right conversation. If you send it from the Proton app instead, Proton's own threading applies.
- If Bridge ever regenerates its certificate (e.g. after a reset), export `cert.pem` again to the same place.

## Keeping your password out of the config (Windows)

Instead of putting `IMAP_PASSWORD` in your config file, you can store it in Windows Credential Manager, where Windows keeps it encrypted and tied to your Windows account:

1. In the `imap-email-mcp` folder, run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\save-password.ps1
   ```
   It asks for your email address and password (the password isn't shown as you type) and saves it under the name `imap-email-mcp`.
2. In your config, replace the `IMAP_PASSWORD` line with:
   ```json
   "IMAP_PASSWORD_CREDENTIAL": "imap-email-mcp",
   ```
3. Restart your MCP client.

Use `-Name something-else` to store more than one account, and `-Remove` to delete a saved password. You can also see the entry in **Control Panel → Credential Manager → Windows Credentials**. If your password changes, run the script again.

What this protects against: the password no longer sits in a plain-text file that gets backed up, synced, copied, or read by other tools. It does not protect against malicious software already running under your Windows account.

## Available tools

| Tool | What it does |
|------|--------------|
| `list_folders` | List all folders (real paths, e.g. `Folders/Receipts`) |
| `list_emails` | Newest emails in a folder, with previews and unread/starred/attachment flags |
| `get_email` | Full email content, with numbered attachment list |
| `search_emails` | Search by subject, sender, recipient, body, any text, date range, unread, starred, has-attachment, or across all folders |
| `mark_email` | Mark read/unread and star/unstar (one or many) |
| `move_email` | Move or archive emails (one or many) |
| `reply_email` | Reply or reply-all in the same thread, with the original quoted; send now or save as a draft |
| `send_email` | Send a new email, with optional attachments |
| `list_drafts` | List drafts |
| `get_draft` | Read a draft |
| `create_draft` | Create a draft, with optional attachments |
| `update_draft` | Replace a draft's content |
| `send_draft` | Send a saved draft exactly as written, then remove it from Drafts |
| `delete_email` | Move an email to Trash (or erase permanently with `permanent: true`, or when deleting from Trash) |
| `download_attachment` | Save one or all attachments to your Downloads folder |

## Usage examples

- "What came in today? Anything unread with attachments?"
- "Search all my folders for emails from the agency since November 1"
- "Reply to that email: confirming Thursday at 2pm. Save it as a draft."
- "Send the draft I just approved"
- "Archive everything from the newsletter and star the invoice"
- "Save the PDF from that email" / "Email the signed form in my Downloads to the coordinator"

## Safety features

- **Review before sending:** ask for a draft first (`create_draft` / `reply_email` with `mode: draft`), then `send_draft` sends exactly what you reviewed.
- **Delete is recoverable:** emails go to Trash unless you explicitly ask for permanent deletion.
- **Strict email IDs:** every tool only accepts single whole-number IDs, so a malformed ID like `1:*` (IMAP for "every message") can never hit a whole folder.
- **No sensitive attachments:** files in AppData, ProgramData, the Windows folder, hidden settings folders (`.ssh`, `.aws`, ...), the server's own folder, and key/certificate/password files (`.pem`, `.key`, `.pfx`, `.kdbx`, `.env`, `claude_desktop_config.json`, SSH keys, ...) are always refused. Paths are checked by their real location, so shortcuts and `..` tricks don't get around it. This matters because an email you ask Claude to read could contain instructions trying to trick it.
- **Downloads stay in Downloads:** attachments can't be saved anywhere else (e.g. your Startup folder), and existing files are never overwritten.
- **Size and volume limits:** attachments are capped at 25 MB per email, results at 100 per request, bulk actions at 500 emails.

## Troubleshooting

**Tools don't show up, or old behavior persists**: fully quit the MCP client (including the system tray) and reopen it. Settings are only read at startup.

**Authentication failed**: check the app password (or Bridge password for Proton) and that IMAP is enabled in your provider's settings. With `IMAP_PASSWORD_CREDENTIAL`, make sure the name matches what you saved.

**`self-signed certificate` error (Proton Bridge)**: `NODE_EXTRA_CA_CERTS` must point to Bridge's exported `cert.pem`, and it must be the current certificate.

**`wrong version number` SSL error**: the encryption mode doesn't match the port. Proton Bridge: set Bridge to SSL mode and use `IMAP_TLS=true` / `SMTP_SECURE=true`. Other providers: port 993/465 = `true`; port 143/587 = `IMAP_TLS=false` / `SMTP_SECURE=false`.

**Emails land in spam**: make sure your domain's SPF, DKIM and DMARC records are set up (check "Show original" in Gmail; all three should say PASS). New domains also need time to build reputation.

**Drafts folder not found**: the server tries common names (`Drafts`, `INBOX.Drafts`, `[Gmail]/Drafts`); your provider may use a different one.

**Connection timeout**: check `IMAP_HOST`/ports, and that the ports aren't blocked by a firewall (or that Bridge is running, for Proton).

## Updating

```bash
cd imap-email-mcp
git pull
npm install
```
Then restart your MCP client. Your `signature.txt` and settings are not touched by updates.

## License and credits

MIT License, see [LICENSE](LICENSE).

Originally created by [jdickey1](https://github.com/jdickey1/imap-email-mcp). This fork extends it; see [CHANGELOG.md](CHANGELOG.md).

## Links

- [Original project](https://github.com/jdickey1/imap-email-mcp)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [Proton Mail Bridge](https://proton.me/mail/bridge)
