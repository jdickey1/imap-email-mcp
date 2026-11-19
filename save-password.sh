#!/usr/bin/env bash
# Saves your email (app) password for imap-email-mcp in your computer's password store,
# so it doesn't have to sit in plain text in your Claude/Cursor config file.
#   macOS: the login Keychain        Linux: the Secret Service keyring (GNOME Keyring / KWallet)
#
# Usage:
#   bash save-password.sh                         # save under the name "imap-email-mcp"
#   bash save-password.sh --name imap-email-mcp/work --user me@example.com
#   bash save-password.sh --name imap-email-mcp --remove
#
# Then set  "IMAP_PASSWORD_CREDENTIAL": "<name>"  in your MCP config and remove IMAP_PASSWORD.
# (Windows users: use save-password.ps1 instead.)

set -euo pipefail

NAME="imap-email-mcp"
EMAIL=""
REMOVE=0

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--name)   NAME="${2:?--name needs a value}"; shift 2 ;;
    -u|--user)   EMAIL="${2:?--user needs a value}"; shift 2 ;;
    -r|--remove) REMOVE=1; shift ;;
    -h|--help)   sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    if [ "$REMOVE" -eq 1 ]; then
      if security delete-generic-password -s "$NAME" >/dev/null 2>&1; then
        echo "Removed the saved password '$NAME' from your Keychain."
      else
        echo "No saved password named '$NAME' was found in your Keychain."
      fi
      exit 0
    fi
    if [ -z "$EMAIL" ]; then read -r -p "Your email address: " EMAIL; fi
    echo "macOS will now ask for the password twice (it isn't shown as you type)."
    # Ending with -w and no value makes `security` prompt for the password itself, so it never
    # appears in this script, the command line, or your shell history. -U replaces an existing entry.
    security add-generic-password -U -s "$NAME" -a "$EMAIL" \
      -l "imap-email-mcp ($EMAIL)" -j "Email password for the imap-email-mcp server" -w
    # Confirm it can be read back (without printing it)
    security find-generic-password -s "$NAME" >/dev/null
    STORE="your Keychain"
    ;;

  Linux)
    if ! command -v secret-tool >/dev/null 2>&1; then
      echo "secret-tool is not installed. Install it first, for example:" >&2
      echo "  Debian/Ubuntu: sudo apt install libsecret-tools" >&2
      echo "  Fedora:        sudo dnf install libsecret" >&2
      echo "  Arch:          sudo pacman -S libsecret" >&2
      echo "Or use IMAP_PASSWORD in your config instead." >&2
      exit 1
    fi
    if [ "$REMOVE" -eq 1 ]; then
      secret-tool clear service "$NAME" && echo "Removed the saved password '$NAME' (if it existed)."
      exit 0
    fi
    if [ -z "$EMAIL" ]; then read -r -p "Your email address: " EMAIL; fi
    echo "Enter the email (app) password (it isn't shown as you type)."
    # secret-tool asks for the password itself when run in a terminal
    secret-tool store --label="imap-email-mcp ($EMAIL)" service "$NAME" account "$EMAIL"
    if ! secret-tool lookup service "$NAME" >/dev/null 2>&1; then
      echo "Saving seemed to work, but the password could not be read back." >&2
      exit 1
    fi
    STORE="your keyring"
    ;;

  *)
    echo "This script supports macOS and Linux. On Windows, run save-password.ps1 instead." >&2
    exit 1
    ;;
esac

echo
echo "Saved in $STORE. In your MCP config's env block, use:"
echo "    \"IMAP_PASSWORD_CREDENTIAL\": \"$NAME\","
echo "and remove any IMAP_PASSWORD line. Then restart Claude (or your MCP client)."
