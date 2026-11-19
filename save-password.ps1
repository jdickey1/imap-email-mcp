<#
.SYNOPSIS
  Saves your email (app) password in Windows Credential Manager for imap-email-mcp,
  so it doesn't have to sit in plain text in your Claude/Cursor config file.

.DESCRIPTION
  You are asked for the password without it being shown on screen. It is stored as a
  Windows "Generic credential", encrypted by Windows and tied to your Windows account.
  Then set IMAP_PASSWORD_CREDENTIAL in your MCP config to the same name, and remove
  IMAP_PASSWORD.

.PARAMETER Name
  The name to store it under (default: imap-email-mcp). Use the same value for
  IMAP_PASSWORD_CREDENTIAL in your config.

.PARAMETER User
  Your email address (stored alongside, for your reference). Asked for if omitted.

.PARAMETER Remove
  Delete the saved credential instead of saving one.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\save-password.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\save-password.ps1 -Name imap-email-mcp/work -User me@example.com

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\save-password.ps1 -Name imap-email-mcp -Remove
#>
param(
  [string]$Name = 'imap-email-mcp',
  [string]$User,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  Write-Error 'This script is for Windows. On macOS or Linux, run: bash save-password.sh'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ImapMcpCredSetup {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWrite(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);

  public static void Write(string target, string user, string secret) {
    byte[] bytes = System.Text.Encoding.Unicode.GetBytes(secret);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1;                 // CRED_TYPE_GENERIC
    c.Persist = 2;              // CRED_PERSIST_LOCAL_MACHINE: this computer, this Windows user
    c.TargetName = target; c.UserName = user;
    c.Comment = "Email password for the imap-email-mcp server";
    c.CredentialBlobSize = bytes.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, c.CredentialBlob, bytes.Length);
      if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      for (int i = 0; i < bytes.Length; i++) bytes[i] = 0;
      Marshal.FreeHGlobal(c.CredentialBlob);
    }
  }
  public static int ReadLength(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return -1;
    try { return ((CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL))).CredentialBlobSize / 2; }
    finally { CredFree(p); }
  }
  public static bool Delete(string target) { return CredDelete(target, 1, 0); }
}
'@

if ($Remove) {
  if ([ImapMcpCredSetup]::Delete($Name)) { Write-Host "Removed the saved password '$Name'." }
  else { Write-Host "No saved password named '$Name' was found." }
  return
}

if (-not $User) { $User = Read-Host 'Your email address' }
$secure = Read-Host "Email (app) password for $User" -AsSecureString
$confirm = Read-Host 'Type it again to confirm' -AsSecureString

$bstr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$bstr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr1)
  if ($plain -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr2)) { throw 'The two passwords did not match. Nothing was saved.' }
  if (-not $plain) { throw 'The password was empty. Nothing was saved.' }
  [ImapMcpCredSetup]::Write($Name, $User, $plain)
} finally {
  $plain = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)
}

if ([ImapMcpCredSetup]::ReadLength($Name) -le 0) { throw 'Saving seemed to work, but the password could not be read back.' }

Write-Host ''
Write-Host "Saved. In your MCP config's env block, use:" -ForegroundColor Green
Write-Host "    `"IMAP_PASSWORD_CREDENTIAL`": `"$Name`","
Write-Host 'and remove any IMAP_PASSWORD line. Then restart Claude (or your MCP client).'
