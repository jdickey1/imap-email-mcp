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
- **Password in your computer's password store** (Windows Credential Manager, macOS Keychain, or Linux keyring) instead of plain text in your config (optional)
- **Works on Windows, macOS and Linux**
- **Up-to-date dependencies**: nodemailer 10 fixes 22 published security advisories in the version the original used

## Requirements

- [Node.js](https://nodejs.org/) **20 or newer** (`node --version` to check)
- An email account with IMAP access, and an **app password** (not your main password) for providers that require one

## Quick start (Claude Desktop)

Nothing to download by hand: Claude Desktop runs the server with `npx`, which fetches it from npm automatically.

1. **Install [Node.js](https://nodejs.org/) 20 or newer** if you don't have it (`node --version` to check).

2. **Open your Claude Desktop config:** Claude Desktop → **Settings → Developer → Edit Config**. This opens the right file even if it isn't in the usual place (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: usually `%APPDATA%\Claude\claude_desktop_config.json`).

3. **Add the server** inside `"mcpServers"` (create that section if it doesn't exist):
   ```json
   {
     "mcpServers": {
       "imap-email": {
         "command": "npx",
         "args": ["-y", "@aylacullen/imap-email-mcp"],
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
   **On a Mac**, use the **full path to `npx`** as the `"command"`: run `which npx` in Terminal and paste the result (often `/opt/homebrew/bin/npx` or `/usr/local/bin/npx`). Claude Desktop is opened from the Dock, not from Terminal, so it may not find a plain `"npx"`.

   You can keep the password out of this file entirely; see [Keeping your password out of the config](#keeping-your-password-out-of-the-config).

4. **Optional signature:** create `~/.imap-email-mcp/signature.txt` (Windows: `C:\Users\you\.imap-email-mcp\signature.txt`) with your sign-off. See [Signature](#signature).

5. **Fully quit and reopen Claude Desktop** (on Windows, also from the system tray; on macOS, with Cmd+Q). Settings are only read at startup. The first start takes a little longer while npx downloads the server.

Then ask Claude things like *"What's new in my inbox?"* or *"Draft a reply to that email saying I'm available Thursday."*

**Note:** `npx -y imap-email-mcp` (without `@aylacullen/`) installs the **original** project, not this fork.

### Claude Code (CLI)

```bash
claude mcp add imap-email -s user \
  -e IMAP_USER=you@example.com \
  -e IMAP_PASSWORD='your-app-password' \
  -e IMAP_HOST=imap.example.com \
  -e SMTP_HOST=smtp.example.com \
  -- npx -y @aylacullen/imap-email-mcp
```

Wrap the password in single quotes if it contains `%`, `^`, `*`, `$`, `!` or similar characters. Restart Claude Code afterwards. Check with `claude mcp get imap-email`; remove with `claude mcp remove imap-email -s user`.

### Cursor

Add an MCP server named `imap-email`, type `command`, command `npx -y @aylacullen/imap-email-mcp`, and set the same environment variables as above in Cursor's MCP settings.

### Pinning a version

`npx -y @aylacullen/imap-email-mcp` always runs the newest release. To stay on a specific version until you choose to update, add it to the name, e.g. `"@aylacullen/imap-email-mcp@1.1.0"`.

### Alternative: run from a clone

If you'd rather have the code on disk (to read it, or change it):
```bash
git clone https://github.com/aylacullen/imap-email-mcp.git
cd imap-email-mcp
npm install
```
Then use `"command": "node"` (on a Mac, the full path from `which node`) and `"args": ["/full/path/to/imap-email-mcp/index.js"]` (on Windows, double every backslash: `"C:\\Users\\you\\imap-email-mcp\\index.js"`). With a clone you can also keep `signature.txt` next to `index.js`.

<details>
<summary>Running straight from GitHub with npx</summary>

`"args": ["--allow-git=all", "-y", "github:aylacullen/imap-email-mcp#v1.1.0"]` also works. `--allow-git=all` is required on npm 12 and newer, which no longer installs packages from GitHub unless you allow it (otherwise you get an `EALLOWGIT` error). Installing from npm, as above, is simpler and faster.
</details>

## Configuration

All settings go in the `env` block of your MCP config.

### Required

| Setting | Description |
|---------|-------------|
| `IMAP_USER` | Your email address |
| `IMAP_PASSWORD` | Your app password. Or use `IMAP_PASSWORD_CREDENTIAL` instead (below) |
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
| `IMAP_PASSWORD_CREDENTIAL` | (none) | Name of a password saved in Windows Credential Manager, the macOS Keychain, or the Linux keyring, used instead of `IMAP_PASSWORD` (see below) |
| `SIGNATURE_FILE` | see [Signature](#signature) | Text file whose contents are added to the end of new emails, drafts and replies. Edits apply immediately, no restart |
| `IMAP_MCP_DATA_DIR` | `~/.imap-email-mcp` | Folder for the server's own data (your signature, if you keep it there, and reply-draft threading notes) |
| `ATTACHMENT_DIR` | `~/Downloads/Email Attachments` | Where `download_attachment` saves files (must be inside Downloads, or this folder) |
| `ATTACHMENT_BLOCK_DIRS` | (none) | Extra folders that may never be attached, separated by `;` on Windows or `:` on macOS/Linux |

**Restart your MCP client after changing any setting.** (Except the signature file, which is re-read every time.)

### Signature

The server adds your signature to the end of new emails, drafts and replies (above the quoted original in replies). It's skipped if the email already contains it, and you can ask for an email without it. It uses the first of these that exists:

1. the file named by `SIGNATURE_FILE`
2. `signature.txt` next to `index.js` (only if you cloned the repo)
3. `signature.txt` in `~/.imap-email-mcp/` (works for every install; on Windows that's `C:\Users\you\.imap-email-mcp\`)

Start from `signature.example.txt`. Your signature is never uploaded or included in updates.

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
     "NODE_EXTRA_CA_CERTS": "/Users/you/bridge-cert/cert.pem",
     "FROM_NAME": "Your Name"
   }
   ```
   (On Windows, the certificate path looks like `"C:\\Users\\you\\bridge-cert\\cert.pem"`.)

**Proton notes**
- **macOS:** Bridge may offer to add its certificate to your Keychain. That helps apps like Apple Mail, but Node doesn't use the Keychain for certificates, so you still need the exported `cert.pem` and `NODE_EXTRA_CA_CERTS`.
- **Sender name:** emails sent directly use `FROM_NAME`. **Drafts** saved to Proton take your Proton display name instead (Proton → Settings → Identity and addresses), so set both to the same name.
- **Reply drafts:** Proton strips threading headers from saved drafts. This server remembers them locally (`~/.imap-email-mcp/draft-threading.json`), so a reply draft sent with `send_draft` still lands in the right conversation. If you send it from the Proton app instead, Proton's own threading applies.
- If Bridge ever regenerates its certificate (e.g. after a reset), export `cert.pem` again to the same place.

## Keeping your password out of the config

Instead of putting `IMAP_PASSWORD` in your config file, you can store it in your computer's own password store, where it's kept encrypted and tied to your user account:

| | Password store |
|---|---|
| **Windows** | Credential Manager |
| **macOS** | Keychain |
| **Linux** | Secret Service keyring (GNOME Keyring / KWallet), via `secret-tool` |

1. **Save the password** with one built-in command. Each one asks for the password itself, without showing it as you type, so it never ends up in your command history. Replace `you@example.com` with your email address.

   **Windows** (Command Prompt or PowerShell):
   ```
   cmdkey /generic:imap-email-mcp /user:you@example.com /pass
   ```
   **macOS** (Terminal; it asks twice):
   ```bash
   security add-generic-password -U -s imap-email-mcp -a you@example.com -w
   ```
   **Linux** (Terminal; install `secret-tool` first if needed: `sudo apt install libsecret-tools`, `sudo dnf install libsecret`, or `sudo pacman -S libsecret`):
   ```bash
   secret-tool store --label="imap-email-mcp" service imap-email-mcp account you@example.com
   ```

2. **In your config**, replace the `IMAP_PASSWORD` line with:
   ```json
   "IMAP_PASSWORD_CREDENTIAL": "imap-email-mcp",
   ```
3. **Restart your MCP client.**

To store more than one account, use a different name in both places (e.g. `imap-email-mcp-work`). If your password changes, run the command again. To remove a saved password: `cmdkey /delete:imap-email-mcp` (Windows), `security delete-generic-password -s imap-email-mcp` (macOS), or `secret-tool clear service imap-email-mcp` (Linux). You can also see the entry in **Credential Manager → Windows Credentials** (Windows) or **Keychain Access** (macOS).

If you cloned the repo, `save-password.ps1` (Windows) and `save-password.sh` (macOS/Linux) do the same with a few extra checks, such as asking for the password twice and confirming it saved.

What this protects against: the password no longer sits in a plain-text file that gets backed up, synced, copied, or read by other tools. It does not protect against malicious software already running under your user account.

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
- **No sensitive attachments:** these are always refused:
  - system and app-settings folders: **Windows** AppData, ProgramData and the Windows folder; **macOS** `~/Library` (app settings, keychains, the Claude config), `/Library`, `/System`, `/etc`, `/var`, `/usr`; **Linux** `/etc`, `/proc`, `/sys`, `/var`, `/usr`, `/root` and similar
  - hidden settings folders in your user folder (`.ssh`, `.aws`, `.config`, `.gnupg`, ...) and the server's own folder
  - key/certificate/password files (`.pem`, `.key`, `.pfx`, `.kdbx`, keychains, `.env`, `claude_desktop_config.json`, SSH keys, ...)

  Paths are checked by their real location, so shortcuts, symlinks and `..` tricks don't get around it. This matters because an email you ask Claude to read could contain instructions trying to trick it.
- **Downloads stay in Downloads:** attachments can't be saved anywhere else (e.g. your Startup folder), and existing files are never overwritten.
- **Size and volume limits:** attachments are capped at 25 MB per email, results at 100 per request, bulk actions at 500 emails.

## Troubleshooting

**Tools don't show up, or old behavior persists**: fully quit the MCP client (on Windows, also from the system tray; on macOS, with Cmd+Q) and reopen it. Settings are only read at startup.

**"spawn node ENOENT" or the server disconnects immediately (macOS)**: Claude Desktop can't find Node. Set `"command"` to the full path from `which node` (for example `/opt/homebrew/bin/node`).

**Authentication failed**: check the app password (or Bridge password for Proton) and that IMAP is enabled in your provider's settings. With `IMAP_PASSWORD_CREDENTIAL`, make sure the name matches what you saved.

**"No saved password named ..."**: the name in `IMAP_PASSWORD_CREDENTIAL` doesn't match a saved entry. Save the password again with that exact name. On Linux, the keyring must be unlocked (it normally unlocks when you log in).

**`self-signed certificate` error (Proton Bridge)**: `NODE_EXTRA_CA_CERTS` must point to Bridge's exported `cert.pem`, and it must be the current certificate.

**`wrong version number` SSL error**: the encryption mode doesn't match the port. Proton Bridge: set Bridge to SSL mode and use `IMAP_TLS=true` / `SMTP_SECURE=true`. Other providers: port 993/465 = `true`; port 143/587 = `IMAP_TLS=false` / `SMTP_SECURE=false`.

**Emails land in spam**: make sure your domain's SPF, DKIM and DMARC records are set up (check "Show original" in Gmail; all three should say PASS). New domains also need time to build reputation.

**Drafts folder not found**: the server tries common names (`Drafts`, `INBOX.Drafts`, `[Gmail]/Drafts`); your provider may use a different one.

**Connection timeout**: check `IMAP_HOST`/ports, and that the ports aren't blocked by a firewall (or that Bridge is running, for Proton).

## Updating

**npx (the quick start setup):** nothing to do; npx picks up new releases on its own. If you pinned a version (`@aylacullen/imap-email-mcp@1.1.0`), change the number to the new release.

**Cloned:**
```bash
cd imap-email-mcp
git pull
npm install
```

Then restart your MCP client. Your signature and settings are not touched by updates.

## License and credits

MIT License, see [LICENSE](LICENSE).

Originally created by [jdickey1](https://github.com/jdickey1/imap-email-mcp). This fork extends it; see [CHANGELOG.md](CHANGELOG.md).

## Links

- [npm package](https://www.npmjs.com/package/@aylacullen/imap-email-mcp)
- [Original project](https://github.com/jdickey1/imap-email-mcp)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [Proton Mail Bridge](https://proton.me/mail/bridge)
