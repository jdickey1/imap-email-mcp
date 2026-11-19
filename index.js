#!/usr/bin/env node

/**
 * IMAP Email MCP Server for Claude Code
 *
 * A Model Context Protocol (MCP) server that provides email capabilities
 * through any IMAP/SMTP email provider.
 *
 * @license MIT
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import imaps from 'imap-simple';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

// Configuration from environment variables
const IMAP_CONFIG = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || '993'),
    tls: process.env.IMAP_TLS !== 'false',
    authTimeout: parseInt(process.env.IMAP_AUTH_TIMEOUT || '10000'),
    // Note: the `imap` library's STARTTLS upgrade crashes (stack overflow) on current Node, so it is
    // left off. For an encrypted IMAP connection use implicit TLS instead (IMAP_TLS=true, e.g. Bridge "SSL" mode).
    tlsOptions: {
      rejectUnauthorized: process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false'
    }
  }
};

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE !== 'false',
  // Refuse to send unless the connection is upgraded to TLS (STARTTLS)
  requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
  auth: {
    user: process.env.SMTP_USER || process.env.IMAP_USER,
    pass: process.env.SMTP_PASSWORD || process.env.IMAP_PASSWORD
  }
};

// Optional display name for the From header (local addition: FROM_NAME)
const FROM_NAME = (process.env.FROM_NAME || '').trim();

// From value for nodemailer (handles encoding itself)
function fromForNodemailer(address) {
  return FROM_NAME ? { name: FROM_NAME, address } : address;
}

// ---- Local additions: attachments, raw message building, folders ----

const MAX_ATTACHMENT_TOTAL = 25 * 1024 * 1024; // Proton's per-message limit
const DEFAULT_ATTACHMENT_DIR = process.env.ATTACHMENT_DIR
  || path.join(os.homedir(), 'Downloads', 'Email Attachments');

// Shared JSON schema for the `attachments` argument
const ATTACHMENTS_SCHEMA = {
  type: 'array',
  description: 'Files to attach. Each item is an absolute file path, or an object { path, filename } to rename the attachment. System and app-settings folders (Windows: AppData, ProgramData, Windows; macOS: ~/Library, /Library, /System, /etc...; Linux: /etc, /var...), hidden settings folders, and key/certificate/password files are always refused.',
  items: {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          filename: { type: 'string', description: 'Name shown to the recipient (optional)' }
        },
        required: ['path']
      }
    ]
  }
};

// ---- Local addition (local.5): never attach secrets or system files ----
// Checked against each file's REAL location (shortcuts/junctions/symlinks resolved), so links can't get around it.
// Rules are per operating system; `platform` etc. are parameters so they can be tested on any OS.
const SENSITIVE_NAME_PATTERNS = [
  /^claude_desktop_config\.json$/i,           // holds MCP settings (and formerly passwords)
  /^\.env(\..*)?$/i,                          // app secrets
  /\.(pem|key|pfx|p12|ppk|kdbx|ovpn)$/i,      // keys, certificates, password vaults, VPN profiles
  /\.keychain(-db)?$/i,                       // macOS keychains
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,    // SSH keys
  /^(credentials|secrets?)(\.\w+)?$/i,
  /^ntuser\.(dat|ini|pol)/i                   // Windows profile hive
];

// Path rules differ by OS: Windows paths and case-insensitive; macOS case-insensitive; Linux case-sensitive
const pathApi = platform => (platform === 'win32' ? path.win32 : path.posix);
const foldCase = platform => (platform === 'win32' || platform === 'darwin' ? s => s.toLowerCase() : s => s);

function isInside(child, parent, platform = process.platform) {
  const P = pathApi(platform), f = foldCase(platform);
  const rel = P.relative(f(parent), f(child));
  return rel === '' || (!rel.startsWith('..') && !P.isAbsolute(rel));
}

function blockedDirsFor(platform, home, env) {
  const P = pathApi(platform);
  if (platform === 'win32') {
    return [
      [env.APPDATA, 'AppData (app settings and saved logins)'],
      [env.LOCALAPPDATA, 'AppData (app settings and saved logins)'],
      [env.PROGRAMDATA, 'ProgramData (system app data)'],
      [env.SystemRoot || 'C:\\Windows', 'the Windows system folder']
    ];
  }
  if (platform === 'darwin') {
    return [
      [P.join(home, 'Library'), 'your Library folder (app settings, keychains and saved logins)'],
      ['/Library', 'the system Library folder'],
      ['/System', 'the macOS system folder'],
      ...['/etc', '/private/etc', '/var', '/private/var', '/usr', '/bin', '/sbin'].map(d => [d, 'a macOS system folder'])
    ];
  }
  // Linux and other Unix-like systems
  return ['/etc', '/proc', '/sys', '/dev', '/boot', '/root', '/var', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/run', '/snap']
    .map(d => [d, 'a system folder']);
}

function attachmentBlockReason(realPath, { platform = process.platform, home = os.homedir(), env = process.env, serverDir = SERVER_DIR } = {}) {
  const P = pathApi(platform), f = foldCase(platform);
  const extra = (env.ATTACHMENT_BLOCK_DIRS || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const blockedDirs = [
    ...blockedDirsFor(platform, home, env),
    [serverDir, 'the email server\'s own folder'],
    ...extra.map(d => [d, 'a blocked folder'])
  ].filter(([d]) => d);
  for (const [dir, label] of blockedDirs) {
    if (isInside(realPath, P.resolve(dir), platform)) return `it is inside ${label}`;
  }
  // Hidden "dot" folders in your user folder (.ssh, .aws, .claude, .config, .gnupg, ...)
  const rel = P.relative(f(home), f(realPath));
  if (rel && !rel.startsWith('..') && !P.isAbsolute(rel) && rel.split(P.sep).some(seg => seg.startsWith('.'))) {
    return 'it is inside a hidden settings folder in your user folder';
  }
  const name = P.basename(realPath);
  if (SENSITIVE_NAME_PATTERNS.some(re => re.test(name))) return 'it looks like a key, certificate, password or settings file';
  return null;
}

// Turn the `attachments` argument into nodemailer attachment objects, checking each file
function resolveAttachments(list) {
  if (!list || list.length === 0) return undefined;
  let total = 0;
  return list.map(item => {
    const spec = typeof item === 'string' ? { path: item } : item;
    if (!spec?.path) throw new Error('Each attachment needs a file path');
    let full;
    try { full = fs.realpathSync.native(path.resolve(spec.path)); } catch { throw new Error(`Attachment not found: ${path.resolve(spec.path)}`); }
    const blocked = attachmentBlockReason(full);
    if (blocked) throw new Error(`Refused to attach ${full}: ${blocked}. Nothing was sent or saved.`);
    let stat;
    try { stat = fs.statSync(full); } catch { throw new Error(`Attachment not found: ${full}`); }
    if (!stat.isFile()) throw new Error(`Attachment is not a file: ${full}`);
    total += stat.size;
    if (total > MAX_ATTACHMENT_TOTAL) {
      throw new Error(`Attachments total more than 25 MB (Proton's limit); stopped at ${full}`);
    }
    return { path: full, filename: spec.filename || path.basename(full) };
  });
}

// Build a complete RFC 5322 message (used for drafts) with nodemailer's composer
async function buildRawMessage(mailOptions) {
  const mail = new MailComposer(mailOptions).compile();
  mail.keepBcc = true; // drafts should remember their Bcc
  return await mail.build();
}

// ---- Local additions (local.4): input validation, safe paths, fast listing ----

// IDs must be single positive whole numbers. Anything else (e.g. "1:*", which means
// "every message" in IMAP) is refused, so a bad ID can never hit a whole folder.
function requireUid(value, label = 'uid') {
  const n = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a single positive whole number (got ${JSON.stringify(value)})`);
  }
  return n;
}

const MAX_LIMIT = 100;
function clampLimit(value, fallback = 20) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// Downloads may only be saved inside the user's Downloads folder (or ATTACHMENT_DIR if set)
const DOWNLOAD_ROOTS = [path.join(os.homedir(), 'Downloads'), DEFAULT_ATTACHMENT_DIR].map(p => path.resolve(p));
function safeSaveDir(requested) {
  const dir = path.resolve(requested || DEFAULT_ATTACHMENT_DIR);
  if (!DOWNLOAD_ROOTS.some(root => isInside(dir, root))) {
    throw new Error(`Attachments can only be saved inside ${DOWNLOAD_ROOTS[0]} (asked for ${dir})`);
  }
  fs.mkdirSync(dir, { recursive: true });
  // Re-check the real location, so a shortcut/junction can't point outside Downloads
  const real = fs.realpathSync(dir);
  if (!DOWNLOAD_ROOTS.some(root => isInside(real, fs.existsSync(root) ? fs.realpathSync(root) : root))) {
    throw new Error(`That folder really points to ${real}, which is outside Downloads, so nothing was saved`);
  }
  return real;
}

// UID SEARCH without fetching anything: just the matching IDs, oldest first
function uidSearch(connection, criteria) {
  return new Promise((resolve, reject) => {
    connection.imap.search(criteria, (err, uids) => (err ? reject(err) : resolve((uids || []).sort((a, b) => a - b))));
  });
}

// Fetch specific UIDs directly (UID FETCH), in the same shape imap-simple's search() returns.
// Note: searching for a UID *list* (SEARCH UID a,b,c) only returns one match on Proton Bridge,
// so never use search() for several UIDs. Missing UIDs are simply left out of the result.
function fetchByUids(connection, uids, { bodies = [], struct = false } = {}) {
  if (!uids.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const messages = [];
    const f = connection.imap.fetch(uids, { bodies, struct });
    f.on('message', msg => {
      const m = { attributes: null, parts: [] };
      const bodyDone = [];
      msg.on('body', (stream, info) => {
        bodyDone.push(new Promise(res => {
          const chunks = [];
          stream.on('data', c => chunks.push(c));
          stream.once('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            m.parts.push({ which: info.which, size: info.size, body: /^HEADER/i.test(info.which) ? Imap.parseHeader(text) : text });
            res();
          });
        }));
      });
      msg.once('attributes', a => { m.attributes = a; });
      msg.once('end', () => messages.push(Promise.all(bodyDone).then(() => m)));
    });
    f.once('error', reject);
    f.once('end', () => Promise.all(messages).then(resolve, reject));
  });
}

// Folder list fetched once per connection and reused
async function getBoxesCached(connection) {
  if (!connection.__boxesCache) connection.__boxesCache = await connection.getBoxes();
  return connection.__boxesCache;
}

// Collect every folder with its real path and attributes (handles any delimiter)
async function listBoxesDetailed(connection) {
  const boxes = await getBoxesCached(connection);
  const out = [];
  (function walk(obj, prefix) {
    for (const [key, value] of Object.entries(obj || {})) {
      const delim = value.delimiter || '/';
      const full = prefix ? `${prefix}${delim}${key}` : key;
      const attribs = [...(value.attribs || []), value.special_use_attrib].filter(Boolean);
      out.push({ path: full, attribs });
      if (value.children) walk(value.children, full);
    }
  })(boxes, '');
  return out;
}

// Find the Trash folder by its special-use flag, falling back to common names
async function findTrashFolder(connection) {
  const boxes = await listBoxesDetailed(connection);
  const bySpecial = boxes.find(b => b.attribs.some(a => String(a).toLowerCase() === '\\trash'));
  if (bySpecial) return bySpecial.path;
  const names = ['Trash', '[Gmail]/Trash', '[Google Mail]/Trash', 'Deleted Items', 'Deleted Messages', 'INBOX.Trash', 'INBOX/Trash'];
  const byName = names.find(n => boxes.some(b => b.path === n));
  if (byName) return byName;
  throw new Error('Could not find a Trash folder');
}

// Fetch and parse one message by UID from an already-open folder
async function fetchParsed(connection, uid) {
  const messages = await connection.search([['UID', requireUid(uid)]], { bodies: [''], struct: true }).catch(() => []);
  if (messages.length === 0) return null;
  const raw = messages[0].parts.find(p => p.which === '')?.body;
  return { attributes: messages[0].attributes, parsed: await simpleParser(raw) };
}

// Make a filename safe for Windows and avoid overwriting existing files
function uniqueSafePath(dir, filename) {
  let base = String(filename || 'attachment').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '');
  if (!base) base = 'attachment';
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let candidate = path.join(dir, base);
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${stem} (${i})${ext}`);
  }
  return candidate;
}

// Addresses from a mailparser address object, as plain "a@b" strings
function addressList(field) {
  if (!field) return [];
  const groups = Array.isArray(field) ? field : [field];
  return groups.flatMap(g => g.value || []).filter(v => v.address);
}

function formatAddress(v) {
  return v.name ? `"${v.name.replace(/(["\\])/g, '\\$1')}" <${v.address}>` : v.address;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---- Local additions (local.3): signature, previews, flags/moves, draft threading ----

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const SIGNATURE_FILE = process.env.SIGNATURE_FILE || path.join(SERVER_DIR, 'signature.txt');
const THREADING_FILE = path.join(SERVER_DIR, 'draft-threading.json');

// Signature is read fresh each time, so editing signature.txt needs no restart
function readSignature() {
  try {
    const s = fs.readFileSync(SIGNATURE_FILE, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
    return s || null;
  } catch {
    return null;
  }
}

const normWs = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function signatureHtml(sig) {
  return escapeHtml(sig).split('\n')
    .map(line => line.replace(/([\w.+-]+@[\w-]+(\.[\w-]+)+)/g, '<a href="mailto:$1">$1</a>'))
    .join('<br>');
}

// Append the signature to text/html bodies unless turned off or already present
function withSignature(text, html, include) {
  if (include === false) return { text, html, signed: false };
  const sig = readSignature();
  if (!sig) return { text, html, signed: false };
  const sigN = normWs(sig);
  if (normWs(text).includes(sigN) || (html && normWs(stripHtml(html)).includes(sigN))) {
    return { text, html, signed: false };
  }
  const newText = text ? `${String(text).replace(/\s+$/, '')}\n\n${sig}` : (html ? text : sig);
  const newHtml = html ? `${html}<br><br><div class="signature">${signatureHtml(sig)}</div>` : html;
  return { text: newText, html: newHtml, signed: true };
}

// Body fields for a new message, with the signature applied per args.include_signature
function signedBody(args) {
  const r = withSignature(args.body || '', args.html, args.include_signature);
  return { text: r.text, html: r.html };
}

const SIGNATURE_SCHEMA = {
  type: 'boolean',
  description: 'Add the saved signature at the end (default: true). It is skipped automatically if the body already contains it, so do not type the signature yourself.',
  default: true
};

// "YYYY-MM-DD" -> local-midnight Date (avoids off-by-one from UTC parsing)
function parseDay(value, label) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) throw new Error(`${label} must be in YYYY-MM-DD format`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Does a BODYSTRUCTURE contain a real attachment?
function structHasAttachment(struct) {
  let found = false;
  (function walk(node) {
    if (found || !node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const disp = node.disposition?.type?.toLowerCase();
    const named = node.disposition?.params?.filename || node.params?.name;
    if (disp === 'attachment' || (named && node.type && node.type.toLowerCase() !== 'text' && disp !== 'inline')) found = true;
  })(struct);
  return found;
}

function makeSnippet(text, len = 160) {
  let t = String(text || '').split(/\r?\n/).filter(l => !/^\s*>/.test(l)).join(' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > len ? `${t.slice(0, len - 1)}…` : t;
}

// Short body preview without downloading attachments: fetch just the first text part
async function previewFor(connection, message) {
  try {
    const parts = imaps.getParts(message.attributes.struct || []);
    const isBody = p => p.type?.toLowerCase() === 'text' && p.disposition?.type?.toLowerCase() !== 'attachment';
    const part = parts.find(p => isBody(p) && p.subtype?.toLowerCase() === 'plain')
      || parts.find(p => isBody(p) && p.subtype?.toLowerCase() === 'html');
    if (!part) return '';
    const data = await connection.getPartData(message, part);
    const text = part.subtype?.toLowerCase() === 'html' ? stripHtml(data) : data;
    return makeSnippet(text);
  } catch {
    return '';
  }
}

// Search one folder and return newest-first summaries (with previews)
// since/before are local-time Dates. The IMAP server compares dates in its own timezone (UTC for Bridge),
// so ask it for a day of slack on each side, then filter exactly by each email's received time here.
// Only the matching IDs are fetched first (cheap); headers are then fetched for just the newest
// ones, in batches, until `limit` results are found. Large folders stay fast.
async function findMessages(connection, folder, criteria, { limit = 20, hasAttachment = false, preview = true, since = null, before = null } = {}) {
  await connection.openBox(folder);
  const DAY = 24 * 60 * 60 * 1000;
  const query = [...criteria];
  if (since) query.push(['SINCE', new Date(since.getTime() - DAY)]);
  if (before) query.push(['BEFORE', new Date(before.getTime() + DAY)]);
  if (query.length > 1) { const i = query.indexOf('ALL'); if (i >= 0) query.splice(i, 1); }

  const uids = await uidSearch(connection, query);
  const inRange = m => {
    const t = new Date(m.attributes.date).getTime();
    if (Number.isNaN(t)) return true;
    return (!since || t >= since.getTime()) && (!before || t < before.getTime());
  };
  const needsCheck = !!(since || before || hasAttachment);
  const batchSize = needsCheck ? 50 : limit;
  const chosen = [];
  let end = uids.length;
  while (end > 0 && chosen.length < limit) {
    const start = Math.max(0, end - batchSize);
    const batch = await fetchByUids(connection, uids.slice(start, end), {
      bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
      struct: true
    });
    end = start;
    batch.sort((a, b) => b.attributes.uid - a.attributes.uid);
    for (const m of batch) {
      if (inRange(m) && (!hasAttachment || structHasAttachment(m.attributes.struct))) {
        chosen.push(m);
        if (chosen.length >= limit) break;
      }
    }
  }
  // Exact count when no extra filtering was needed, or when every candidate was checked
  const totalMatches = !needsCheck ? uids.length : (end === 0 && chosen.length < limit ? chosen.length : null);

  const results = [];
  for (const msg of chosen) {
    const header = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
    const item = {
      folder,
      uid: msg.attributes.uid,
      date: header.date?.[0],
      from: header.from?.[0],
      to: header.to?.[0],
      subject: header.subject?.[0],
      unread: !(msg.attributes.flags || []).includes('\\Seen'),
      starred: (msg.attributes.flags || []).includes('\\Flagged'),
      has_attachment: structHasAttachment(msg.attributes.struct)
    };
    if (preview) item.preview = await previewFor(connection, msg);
    results.push(item);
  }
  return { results, totalMatches };
}

// Find a folder by special-use flag (e.g. '\\All', '\\Archive') or by name/path, any delimiter, any case
async function resolveFolder(connection, wanted) {
  const boxes = await listBoxesDetailed(connection);
  const key = s => String(s).replace(/[./]/g, '/').toLowerCase();
  const exact = boxes.find(b => key(b.path) === key(wanted));
  if (exact) return exact.path;
  const special = boxes.find(b => b.attribs.some(a => String(a).toLowerCase() === `\\${String(wanted).toLowerCase().replace(/\s+/g, '')}`));
  if (special) return special.path;
  throw new Error(`Folder "${wanted}" not found. Available: ${boxes.map(b => b.path).join(', ')}`);
}

async function findAllMailFolder(connection) {
  const boxes = await listBoxesDetailed(connection);
  const byFlag = boxes.find(b => b.attribs.some(a => String(a).toLowerCase() === '\\all'));
  if (byFlag) return byFlag.path;
  const byName = boxes.find(b => ['all mail', '[gmail]/all mail'].includes(b.path.toLowerCase()));
  if (byName) return byName.path;
  return null;
}

// Accept uid (number) and/or uids (array); return a clean list of numbers
function collectUids(args) {
  if (args.uids !== undefined && args.uids !== null && !Array.isArray(args.uids)) {
    throw new Error('uids must be a list of numbers');
  }
  const list = [...(args.uids || []), ...(args.uid !== undefined && args.uid !== null ? [args.uid] : [])]
    .map(v => requireUid(v, 'each uid'));
  if (list.length === 0) throw new Error('Give a uid or a list of uids');
  if (list.length > 500) throw new Error('At most 500 emails at a time');
  return [...new Set(list)];
}

// Threading info for reply drafts, kept locally because Proton strips those headers from drafts
function loadThreading() {
  try { return JSON.parse(fs.readFileSync(THREADING_FILE, 'utf8')); } catch { return {}; }
}
function saveThreading(map) {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000; // forget entries older than 90 days
  for (const [k, v] of Object.entries(map)) if (!v.savedAt || v.savedAt < cutoff) delete map[k];
  fs.writeFileSync(THREADING_FILE, JSON.stringify(map, null, 2));
}
function newMessageId() {
  const domain = String(IMAP_CONFIG.imap.user || 'localhost').split('@')[1] || 'localhost';
  return `<${crypto.randomUUID()}@${domain}>`;
}

const UIDS_SCHEMA = {
  uid: { type: 'number', description: 'Email UID' },
  uids: { type: 'array', items: { type: 'number' }, description: 'Several email UIDs (instead of, or along with, uid)' }
};

// ---- Local addition (local.5): password from the OS password store ----
// Set IMAP_PASSWORD_CREDENTIAL to a saved entry's name instead of putting IMAP_PASSWORD in the config.
// Windows: Credential Manager (Generic credential). macOS: Keychain. Linux: Secret Service (secret-tool).
// On Windows, Node can't call the credential API directly, so a tiny PowerShell step (full system path,
// no profile) calls CredRead and hands the password back over a pipe. It is never written to disk or logged.
const CREDMAN_CS = `
using System;
using System.Runtime.InteropServices;
public static class McpCredMan {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
}`;

function readWindowsCredential(target) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition $env:MCP_CREDMAN_CS",
    '$v = [McpCredMan]::Read($env:MCP_CRED_TARGET)',
    'if ($null -eq $v) { exit 3 }',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '[Console]::Out.Write($v)'
  ].join('\n');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      env: { ...process.env, MCP_CRED_TARGET: target, MCP_CREDMAN_CS: CREDMAN_CS },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    if (e.status === 3) throw new Error(`No saved password named "${target}" in Windows Credential Manager`);
    throw new Error(`Could not read the password from Windows Credential Manager (${(e.stderr || e.message || '').toString().split('\n')[0]})`);
  }
}

// macOS Keychain: items saved with `security add-generic-password -s <name>` (see save-password.sh).
// Linux: Secret Service keyring via `secret-tool` (GNOME Keyring / KWallet).
function readStoredPassword(name, platform = process.platform) {
  const firstLine = e => (e.stderr || e.message || '').toString().trim().split('\n')[0];
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });

  if (platform === 'win32') return readWindowsCredential(name);

  if (platform === 'darwin') {
    try {
      // -w prints only the password (plus one trailing newline, removed here)
      return run('/usr/bin/security', ['find-generic-password', '-s', name, '-w']).replace(/\r?\n$/, '');
    } catch (e) {
      if (e.status === 44) throw new Error(`No saved password named "${name}" in the macOS Keychain`);
      throw new Error(`Could not read the password from the macOS Keychain (${firstLine(e)})`);
    }
  }

  if (platform === 'linux') {
    const tool = fs.existsSync('/usr/bin/secret-tool') ? '/usr/bin/secret-tool' : 'secret-tool';
    let out;
    try {
      out = run(tool, ['lookup', 'service', name]);
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('secret-tool is not installed (package "libsecret-tools" / "libsecret"). Install it, or use IMAP_PASSWORD instead');
      throw new Error(`No saved password named "${name}" in your keyring, or the keyring is locked (${firstLine(e)})`);
    }
    if (!out) throw new Error(`No saved password named "${name}" in your keyring`);
    return out.replace(/\r?\n$/, '');
  }

  throw new Error(`IMAP_PASSWORD_CREDENTIAL is not supported on ${platform}. Use IMAP_PASSWORD instead`);
}

function loadSecrets() {
  const target = process.env.IMAP_PASSWORD_CREDENTIAL;
  if (!process.env.IMAP_PASSWORD && target) {
    const password = readStoredPassword(target);
    IMAP_CONFIG.imap.password = password;
    if (!process.env.SMTP_PASSWORD) SMTP_CONFIG.auth.pass = password;
  }
}

// Validate required configuration
function validateConfig() {
  const required = ['IMAP_USER', 'IMAP_HOST'];
  const missing = required.filter(key => !process.env[key]);
  if (!IMAP_CONFIG.imap.password) missing.push('IMAP_PASSWORD (or IMAP_PASSWORD_CREDENTIAL)');

  if (missing.length > 0) {
    console.error(`Missing required settings: ${missing.join(', ')}`);
    console.error('Please set these variables before starting the server.');
    process.exit(1);
  }

  // SMTP host defaults to IMAP host if not set
  if (!process.env.SMTP_HOST) {
    SMTP_CONFIG.host = process.env.IMAP_HOST;
  }
}

const server = new Server(
  {
    name: 'imap-email-mcp',
    version: '1.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_folders',
        description: 'List all email folders/mailboxes in the IMAP account',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'list_emails',
        description: 'List the newest emails in a folder (newest first), each with a short preview, unread/starred status and whether it has attachments',
        inputSchema: {
          type: 'object',
          properties: {
            folder: {
              type: 'string',
              description: 'Folder name (default: INBOX)',
              default: 'INBOX'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of emails to return (default: 20)',
              default: 20
            },
            unseen_only: {
              type: 'boolean',
              description: 'Only return unread emails',
              default: false
            },
            since_date: {
              type: 'string',
              description: 'Only return emails on or after this date (YYYY-MM-DD)'
            },
            preview: {
              type: 'boolean',
              description: 'Include a one-line preview of each email (default: true)',
              default: true
            }
          },
          required: []
        }
      },
      {
        name: 'get_email',
        description: 'Get full email content by UID',
        inputSchema: {
          type: 'object',
          properties: {
            uid: {
              type: 'number',
              description: 'Email UID'
            },
            folder: {
              type: 'string',
              description: 'Folder name (default: INBOX)',
              default: 'INBOX'
            }
          },
          required: ['uid']
        }
      },
      {
        name: 'search_emails',
        description: 'Search emails (newest first, with previews). All filters combine (AND). Use all_folders to search everything at once; each result says which folder it is in, so use that folder for follow-up calls.',
        inputSchema: {
          type: 'object',
          properties: {
            folder: {
              type: 'string',
              description: 'Folder to search (default: INBOX). Ignored when all_folders is true.',
              default: 'INBOX'
            },
            all_folders: {
              type: 'boolean',
              description: 'Search every folder at once (uses All Mail)',
              default: false
            },
            subject: {
              type: 'string',
              description: 'Text in the subject line'
            },
            from: {
              type: 'string',
              description: 'Sender name or address'
            },
            to: {
              type: 'string',
              description: 'Recipient name or address'
            },
            body: {
              type: 'string',
              description: 'Text in the body'
            },
            text: {
              type: 'string',
              description: 'Text anywhere (headers or body)'
            },
            since: {
              type: 'string',
              description: 'On or after this date (YYYY-MM-DD)'
            },
            before: {
              type: 'string',
              description: 'Before this date, not including it (YYYY-MM-DD)'
            },
            unread_only: {
              type: 'boolean',
              description: 'Only unread emails',
              default: false
            },
            starred_only: {
              type: 'boolean',
              description: 'Only starred emails',
              default: false
            },
            has_attachment: {
              type: 'boolean',
              description: 'Only emails with attachments',
              default: false
            },
            preview: {
              type: 'boolean',
              description: 'Include a one-line preview of each email (default: true)',
              default: true
            },
            limit: {
              type: 'number',
              description: 'Maximum results (default: 20)',
              default: 20
            }
          },
          required: []
        }
      },
      {
        name: 'mark_email',
        description: 'Mark one or more emails as read/unread and/or starred/unstarred',
        inputSchema: {
          type: 'object',
          properties: {
            ...UIDS_SCHEMA,
            folder: {
              type: 'string',
              description: 'Folder the emails are in (default: INBOX)',
              default: 'INBOX'
            },
            read: {
              type: 'boolean',
              description: 'true = mark read, false = mark unread (omit to leave as is)'
            },
            starred: {
              type: 'boolean',
              description: 'true = star, false = unstar (omit to leave as is)'
            }
          },
          required: []
        }
      },
      {
        name: 'move_email',
        description: 'Move one or more emails to another folder, e.g. "Archive", "INBOX", "Spam", or a custom folder like "Folders/Receipts" (see list_folders). Not for deleting; use delete_email.',
        inputSchema: {
          type: 'object',
          properties: {
            ...UIDS_SCHEMA,
            folder: {
              type: 'string',
              description: 'Folder the emails are in now (default: INBOX)',
              default: 'INBOX'
            },
            to_folder: {
              type: 'string',
              description: 'Destination folder, e.g. "Archive"'
            }
          },
          required: ['to_folder']
        }
      },
      {
        name: 'send_draft',
        description: 'Send an existing draft from the Drafts folder exactly as saved (recipients, subject, body, attachments), then remove it from Drafts. Reply drafts made with reply_email stay in their thread.',
        inputSchema: {
          type: 'object',
          properties: {
            uid: {
              type: 'number',
              description: 'Draft UID (from list_drafts)'
            }
          },
          required: ['uid']
        }
      },
      {
        name: 'list_drafts',
        description: 'List all draft emails',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of drafts to return (default: 20)',
              default: 20
            }
          },
          required: []
        }
      },
      {
        name: 'get_draft',
        description: 'Get a specific draft email by UID',
        inputSchema: {
          type: 'object',
          properties: {
            uid: {
              type: 'number',
              description: 'Draft UID'
            }
          },
          required: ['uid']
        }
      },
      {
        name: 'create_draft',
        description: 'Create a new draft email',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address(es), comma-separated'
            },
            subject: {
              type: 'string',
              description: 'Email subject'
            },
            body: {
              type: 'string',
              description: 'Email body (plain text)'
            },
            html: {
              type: 'string',
              description: 'Email body (HTML)'
            },
            cc: {
              type: 'string',
              description: 'CC recipients, comma-separated'
            },
            bcc: {
              type: 'string',
              description: 'BCC recipients, comma-separated'
            },
            attachments: ATTACHMENTS_SCHEMA,
            include_signature: SIGNATURE_SCHEMA
          },
          required: ['to', 'subject']
        }
      },
      {
        name: 'update_draft',
        description: 'Update an existing draft by deleting old and creating new',
        inputSchema: {
          type: 'object',
          properties: {
            uid: {
              type: 'number',
              description: 'UID of draft to update'
            },
            to: {
              type: 'string',
              description: 'Recipient email address(es)'
            },
            subject: {
              type: 'string',
              description: 'Email subject'
            },
            body: {
              type: 'string',
              description: 'Email body (plain text)'
            },
            html: {
              type: 'string',
              description: 'Email body (HTML)'
            },
            cc: {
              type: 'string',
              description: 'CC recipients'
            },
            bcc: {
              type: 'string',
              description: 'BCC recipients'
            },
            attachments: ATTACHMENTS_SCHEMA,
            include_signature: SIGNATURE_SCHEMA
          },
          required: ['uid', 'to', 'subject']
        }
      },
      {
        name: 'send_email',
        description: 'Send a new email directly (use reply_email to answer an existing email). Supports file attachments.',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address(es)'
            },
            subject: {
              type: 'string',
              description: 'Email subject'
            },
            body: {
              type: 'string',
              description: 'Email body (plain text)'
            },
            html: {
              type: 'string',
              description: 'Email body (HTML)'
            },
            cc: {
              type: 'string',
              description: 'CC recipients'
            },
            bcc: {
              type: 'string',
              description: 'BCC recipients'
            },
            attachments: ATTACHMENTS_SCHEMA,
            include_signature: SIGNATURE_SCHEMA
          },
          required: ['to', 'subject']
        }
      },
      {
        name: 'reply_email',
        description: 'Reply to an existing email so it stays in the same conversation thread (sets In-Reply-To/References, "Re:" subject, and quotes the original). Can send now or save as a draft.',
        inputSchema: {
          type: 'object',
          properties: {
            uid: {
              type: 'number',
              description: 'UID of the email being replied to'
            },
            folder: {
              type: 'string',
              description: 'Folder the original email is in (default: INBOX)',
              default: 'INBOX'
            },
            mode: {
              type: 'string',
              enum: ['send', 'draft'],
              description: '"send" sends the reply now; "draft" saves it to Drafts for review'
            },
            body: {
              type: 'string',
              description: 'Reply text (plain text), written above the quoted original'
            },
            html: {
              type: 'string',
              description: 'Reply text as HTML (optional)'
            },
            reply_all: {
              type: 'boolean',
              description: 'Also reply to everyone in To/Cc of the original (default: false)',
              default: false
            },
            cc: {
              type: 'string',
              description: 'Extra CC recipients'
            },
            bcc: {
              type: 'string',
              description: 'BCC recipients'
            },
            include_quote: {
              type: 'boolean',
              description: 'Quote the original message below the reply (default: true)',
              default: true
            },
            attachments: ATTACHMENTS_SCHEMA,
            include_signature: SIGNATURE_SCHEMA
          },
          required: ['uid', 'mode', 'body']
        }
      },
      {
        name: 'delete_email',
        description: 'Delete an email by UID. By default it is moved to Trash (recoverable). Permanent deletion only happens with permanent=true, or when deleting from Trash itself.',
        inputSchema: {
          type: 'object',
          properties: {
            uid: {
              type: 'number',
              description: 'Email UID to delete'
            },
            folder: {
              type: 'string',
              description: 'Folder name (default: INBOX)',
              default: 'INBOX'
            },
            permanent: {
              type: 'boolean',
              description: 'Erase permanently instead of moving to Trash (default: false). Cannot be undone.',
              default: false
            }
          },
          required: ['uid']
        }
      },
      {
        name: 'download_attachment',
        description: `Save attachments from an email to a folder on this computer (default: ${DEFAULT_ATTACHMENT_DIR}). Never overwrites existing files.`,
        inputSchema: {
          type: 'object',
          properties: {
            uid: {
              type: 'number',
              description: 'Email UID'
            },
            folder: {
              type: 'string',
              description: 'Folder the email is in (default: INBOX)',
              default: 'INBOX'
            },
            index: {
              type: 'number',
              description: 'Which attachment to save, by its index from get_email. Omit (with no filename) to save all attachments.'
            },
            filename: {
              type: 'string',
              description: 'Which attachment to save, by its filename. Omit (with no index) to save all attachments.'
            },
            save_dir: {
              type: 'string',
              description: 'Folder to save into (created if missing). Must be inside the Downloads folder.'
            }
          },
          required: ['uid']
        }
      }
    ]
  };
});

// Helper function to connect to IMAP
async function connectIMAP() {
  if (!IMAP_CONFIG.imap.password) {
    throw new Error('IMAP_PASSWORD environment variable is not set');
  }
  return await imaps.connect(IMAP_CONFIG);
}

// Helper to find drafts folder (handles different provider conventions)
async function findDraftsFolder(connection) {
  const boxes = await getBoxesCached(connection);

  // Common drafts folder names across providers
  const draftNames = [
    'Drafts',
    'INBOX.Drafts',
    '[Gmail]/Drafts',
    '[Google Mail]/Drafts',
    'Draft',
    'INBOX/Drafts'
  ];

  for (const name of draftNames) {
    if (boxes[name] || name.split('.').reduce((acc, part) => acc?.[part], boxes)) {
      return name;
    }
  }

  // Check for nested Drafts under INBOX
  if (boxes.INBOX && boxes.INBOX.children && boxes.INBOX.children.Drafts) {
    return 'INBOX.Drafts';
  }

  return 'Drafts'; // Default fallback
}

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_folders': {
        const connection = await connectIMAP();
        try {
          // Real folder paths (with the server's own delimiter), usable directly in other tools
          const folders = (await listBoxesDetailed(connection)).map(b => b.path);
          return { content: [{ type: 'text', text: JSON.stringify(folders, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'list_emails': {
        const folder = args.folder || 'INBOX';
        const limit = clampLimit(args.limit);
        const connection = await connectIMAP();

        try {
          const criteria = [];
          if (args.unseen_only) criteria.push('UNSEEN');
          if (criteria.length === 0) criteria.push('ALL');

          const { results } = await findMessages(connection, folder, criteria, {
            limit,
            preview: args.preview !== false,
            since: args.since_date ? parseDay(args.since_date, 'since_date') : null
          });
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'get_email': {
        const folder = args.folder || 'INBOX';
        const connection = await connectIMAP();

        try {
          await connection.openBox(folder);

          const fetchOptions = {
            bodies: [''],
            struct: true
          };

          const messages = await connection.search([['UID', requireUid(args.uid)]], fetchOptions);

          if (messages.length === 0) {
            return { content: [{ type: 'text', text: 'Email not found' }] };
          }

          const msg = messages[0];
          const rawBody = msg.parts.find(p => p.which === '')?.body;
          const parsed = await simpleParser(rawBody);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                uid: msg.attributes.uid,
                from: parsed.from?.text,
                to: parsed.to?.text,
                cc: parsed.cc?.text,
                subject: parsed.subject,
                date: parsed.date,
                text: parsed.text,
                html: parsed.html,
                attachments: parsed.attachments?.map((a, index) => ({
                  index,
                  filename: a.filename,
                  contentType: a.contentType,
                  size: a.size
                }))
              }, null, 2)
            }]
          };
        } finally {
          connection.end();
        }
      }

      case 'search_emails': {
        const limit = clampLimit(args.limit);
        const connection = await connectIMAP();

        try {
          let folder = args.folder || 'INBOX';
          if (args.all_folders) {
            folder = await findAllMailFolder(connection);
            if (!folder) throw new Error('This account has no "All Mail" folder, so all_folders is not available. Search one folder at a time.');
          }

          const criteria = [];
          if (args.subject) criteria.push(['SUBJECT', args.subject]);
          if (args.from) criteria.push(['FROM', args.from]);
          if (args.to) criteria.push(['TO', args.to]);
          if (args.body) criteria.push(['BODY', args.body]);
          if (args.text) criteria.push(['TEXT', args.text]);
          if (args.unread_only) criteria.push('UNSEEN');
          if (args.starred_only) criteria.push('FLAGGED');
          if (criteria.length === 0) criteria.push('ALL');

          const { results, totalMatches } = await findMessages(connection, folder, criteria, {
            limit,
            hasAttachment: !!args.has_attachment,
            preview: args.preview !== false,
            since: args.since ? parseDay(args.since, 'since') : null,
            before: args.before ? parseDay(args.before, 'before') : null
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                searched: folder,
                totalMatches: totalMatches ?? `more than ${results.length}`,
                showing: results.length,
                results
              }, null, 2)
            }]
          };
        } finally {
          connection.end();
        }
      }

      case 'mark_email': {
        const folder = args.folder || 'INBOX';
        const uids = collectUids(args);
        if (args.read === undefined && args.starred === undefined) {
          throw new Error('Say what to change: read (true/false) and/or starred (true/false)');
        }
        const connection = await connectIMAP();

        try {
          await connection.openBox(folder);
          const found = (await fetchByUids(connection, uids, {})).map(m => m.attributes.uid);
          const missing = uids.filter(u => !found.includes(u));
          if (found.length === 0) throw new Error(`None of those emails were found in ${folder}, so nothing was changed`);
          const changes = [];
          if (args.read === true) { await connection.addFlags(found, ['\\Seen']); changes.push('marked read'); }
          if (args.read === false) { await connection.delFlags(found, ['\\Seen']); changes.push('marked unread'); }
          if (args.starred === true) { await connection.addFlags(found, ['\\Flagged']); changes.push('starred'); }
          if (args.starred === false) { await connection.delFlags(found, ['\\Flagged']); changes.push('unstarred'); }
          let text = `${found.length} email(s) in ${folder} ${changes.join(' and ')} (UIDs: ${found.join(', ')})`;
          if (missing.length) text += `. Not found (skipped): ${missing.join(', ')}`;
          return { content: [{ type: 'text', text }] };
        } finally {
          connection.end();
        }
      }

      case 'move_email': {
        const folder = args.folder || 'INBOX';
        const uids = collectUids(args);
        const connection = await connectIMAP();

        try {
          const source = await resolveFolder(connection, folder);
          const target = await resolveFolder(connection, args.to_folder);
          if (source.toLowerCase() === target.toLowerCase()) throw new Error(`The email(s) are already in ${target}`);
          const trash = await findTrashFolder(connection).catch(() => null);
          if (trash && target.toLowerCase() === trash.toLowerCase()) {
            throw new Error('To delete, use delete_email (it moves to Trash safely)');
          }

          await connection.openBox(source);
          const found = await fetchByUids(connection, uids, { bodies: ['HEADER.FIELDS (SUBJECT)'] });
          const foundUids = found.map(m => m.attributes.uid);
          const missing = uids.filter(u => !foundUids.includes(u));
          if (foundUids.length === 0) throw new Error(`None of those emails were found in ${source}, so nothing was moved`);

          await connection.moveMessage(foundUids.join(','), target);
          const subjects = found.map(m => m.parts[0]?.body?.subject?.[0] || '(no subject)');
          let text = `Moved ${foundUids.length} email(s) from ${source} to ${target}: ${subjects.map(s => `"${s}"`).join(', ')}`;
          if (missing.length) text += `. Not found (skipped): ${missing.join(', ')}`;
          return { content: [{ type: 'text', text }] };
        } finally {
          connection.end();
        }
      }

      case 'send_draft': {
        if (!SMTP_CONFIG.host) throw new Error('SMTP_HOST not configured. Cannot send emails.');
        const connection = await connectIMAP();

        try {
          const draftUid = requireUid(args.uid);
          const draftsFolder = await findDraftsFolder(connection);
          await connection.openBox(draftsFolder);
          const draft = await fetchParsed(connection, draftUid);
          if (!draft) throw new Error(`Draft ${args.uid} not found in ${draftsFolder}`);
          const p = draft.parsed;

          const to = p.to?.text, cc = p.cc?.text, bcc = p.bcc?.text;
          if (!to && !cc && !bcc) throw new Error('That draft has no recipients, so it was not sent');

          // Threading: Proton strips In-Reply-To/References from drafts, so use our saved copy
          const threading = loadThreading();
          const saved = p.messageId ? threading[p.messageId] : null;
          const inReplyTo = p.inReplyTo || saved?.inReplyTo;
          const ownRefs = (Array.isArray(p.references) ? p.references : (p.references ? String(p.references).split(/\s+/) : []))
            .filter(r => r && !/@protonmail\.internalid>?$/i.test(r));
          const references = ownRefs.length ? ownRefs
            : saved?.references?.filter(r => !/@protonmail\.internalid>?$/i.test(r));

          const mailOptions = {
            from: fromForNodemailer(SMTP_CONFIG.auth.user),
            to, cc, bcc,
            subject: p.subject || '',
            text: p.text,
            html: p.html || undefined,
            inReplyTo,
            references,
            attachments: (p.attachments || []).map(a => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
              cid: a.cid,
              contentDisposition: a.contentDisposition
            }))
          };

          const info = await nodemailer.createTransport(SMTP_CONFIG).sendMail(mailOptions);

          // Remove the sent draft and its saved threading info
          await connection.addFlags(draftUid, ['\\Deleted']);
          await connection.closeBox(true);
          if (saved) { delete threading[p.messageId]; saveThreading(threading); }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                messageId: info.messageId,
                response: info.response,
                to, cc, bcc,
                subject: mailOptions.subject,
                attachments: mailOptions.attachments.map(a => a.filename),
                threaded: !!inReplyTo,
                draftRemoved: true
              }, null, 2)
            }]
          };
        } finally {
          connection.end();
        }
      }

      case 'list_drafts': {
        const limit = clampLimit(args.limit);
        const connection = await connectIMAP();

        try {
          const draftsFolder = await findDraftsFolder(connection);
          await connection.openBox(draftsFolder);

          // Fetch only the newest `limit` drafts, not every draft
          const uids = await uidSearch(connection, ['ALL']);
          const messages = await fetchByUids(connection, uids.slice(-limit), {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)']
          });
          messages.sort((a, b) => a.attributes.uid - b.attributes.uid);
          const results = messages.reverse().map(msg => {
            const header = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
            return {
              uid: msg.attributes.uid,
              date: header.date?.[0],
              to: header.to?.[0],
              subject: header.subject?.[0]
            };
          });

          return { content: [{ type: 'text', text: JSON.stringify({ folder: draftsFolder, drafts: results }, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'get_draft': {
        const connection = await connectIMAP();

        try {
          const draftsFolder = await findDraftsFolder(connection);
          await connection.openBox(draftsFolder);

          const fetchOptions = {
            bodies: [''],
            struct: true
          };

          const messages = await connection.search([['UID', requireUid(args.uid)]], fetchOptions);

          if (messages.length === 0) {
            return { content: [{ type: 'text', text: 'Draft not found' }] };
          }

          const msg = messages[0];
          const rawBody = msg.parts.find(p => p.which === '')?.body;
          const parsed = await simpleParser(rawBody);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                uid: msg.attributes.uid,
                to: parsed.to?.text,
                cc: parsed.cc?.text,
                bcc: parsed.bcc?.text,
                subject: parsed.subject,
                date: parsed.date,
                text: parsed.text,
                html: parsed.html
              }, null, 2)
            }]
          };
        } finally {
          connection.end();
        }
      }

      case 'create_draft': {
        const connection = await connectIMAP();

        try {
          const draftsFolder = await findDraftsFolder(connection);
          const attachments = resolveAttachments(args.attachments);

          const message = await buildRawMessage({
            from: fromForNodemailer(IMAP_CONFIG.imap.user),
            to: args.to,
            cc: args.cc,
            bcc: args.bcc,
            subject: args.subject,
            ...signedBody(args),
            attachments
          });

          await connection.append(message, { mailbox: draftsFolder, flags: ['\\Draft'] });

          const note = attachments ? ` with ${attachments.length} attachment(s): ${attachments.map(a => a.filename).join(', ')}` : '';
          return { content: [{ type: 'text', text: `Draft created successfully in ${draftsFolder}${note}` }] };
        } finally {
          connection.end();
        }
      }

      case 'update_draft': {
        const connection = await connectIMAP();

        try {
          const oldUid = requireUid(args.uid);
          const draftsFolder = await findDraftsFolder(connection);
          // Check attachments and build the new draft first, so a bad file path doesn't lose the old draft
          const attachments = resolveAttachments(args.attachments);
          const message = await buildRawMessage({
            from: fromForNodemailer(IMAP_CONFIG.imap.user),
            to: args.to,
            cc: args.cc,
            bcc: args.bcc,
            subject: args.subject,
            ...signedBody(args),
            attachments
          });

          await connection.openBox(draftsFolder);

          // Make sure the old draft really exists before touching anything
          const existing = await connection.search([['UID', oldUid]], { bodies: ['HEADER.FIELDS (SUBJECT)'] }).catch(() => []);
          if (existing.length === 0) throw new Error(`Draft ${oldUid} not found in ${draftsFolder}, so nothing was changed`);
          const oldSubject = existing[0].parts[0]?.body?.subject?.[0] || '(no subject)';

          // Save the new version first, then remove the old one, so a failure never loses the draft
          await connection.append(message, { mailbox: draftsFolder, flags: ['\\Draft'] });
          await connection.addFlags(oldUid, ['\\Deleted']);
          await connection.closeBox(true); // Expunge just the old draft

          return { content: [{ type: 'text', text: `Draft updated: replaced "${oldSubject}" with "${args.subject}"` }] };
        } finally {
          connection.end();
        }
      }

      case 'send_email': {
        if (!SMTP_CONFIG.host) {
          return {
            content: [{ type: 'text', text: 'Error: SMTP_HOST not configured. Cannot send emails.' }],
            isError: true
          };
        }

        const transporter = nodemailer.createTransport(SMTP_CONFIG);

        const mailOptions = {
          from: fromForNodemailer(SMTP_CONFIG.auth.user),
          to: args.to,
          subject: args.subject,
          ...signedBody(args),
          cc: args.cc,
          bcc: args.bcc,
          attachments: resolveAttachments(args.attachments)
        };

        const info = await transporter.sendMail(mailOptions);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              messageId: info.messageId,
              response: info.response,
              attachments: mailOptions.attachments?.map(a => a.filename)
            }, null, 2)
          }]
        };
      }

      case 'reply_email': {
        const folder = args.folder || 'INBOX';
        if (args.mode !== 'send' && args.mode !== 'draft') {
          throw new Error('mode must be "send" or "draft"');
        }
        if (args.mode === 'send' && !SMTP_CONFIG.host) {
          throw new Error('SMTP_HOST not configured. Cannot send emails.');
        }
        const attachments = resolveAttachments(args.attachments);
        const connection = await connectIMAP();

        try {
          await connection.openBox(folder);
          const original = await fetchParsed(connection, args.uid);
          if (!original) throw new Error(`Email ${args.uid} not found in ${folder}`);
          const p = original.parsed;

          const me = (SMTP_CONFIG.auth.user || '').toLowerCase();
          const notMe = v => v.address.toLowerCase() !== me;

          // Who to reply to: Reply-To if present, else the sender (or the original recipients if I sent it)
          let toList = addressList(p.replyTo).length ? addressList(p.replyTo) : addressList(p.from);
          if (toList.every(v => !notMe(v))) toList = addressList(p.to);
          let ccList = [];
          if (args.reply_all) {
            const seen = new Set(toList.map(v => v.address.toLowerCase()));
            for (const v of [...addressList(p.to), ...addressList(p.cc)]) {
              const key = v.address.toLowerCase();
              if (!seen.has(key) && notMe(v)) { seen.add(key); ccList.push(v); }
            }
          }
          const to = toList.map(formatAddress).join(', ');
          const cc = [...ccList.map(formatAddress), ...(args.cc ? [args.cc] : [])].join(', ') || undefined;
          if (!to) throw new Error('Could not work out who to reply to');

          const origSubject = p.subject || '';
          const subject = /^\s*re\s*:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;

          // Threading headers
          const refs = (Array.isArray(p.references) ? p.references : (p.references ? String(p.references).split(/\s+/) : []))
            .filter(r => r && !/@protonmail\.internalid>?$/i.test(r)); // Proton-internal IDs mean nothing to others
          const references = p.messageId ? [...refs, p.messageId].filter(Boolean) : refs;

          // Reply text + signature, then the quoted original below it
          let { text, html } = signedBody(args);
          if (args.include_quote !== false) {
            const when = p.date ? p.date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'an earlier date';
            const who = p.from?.text || 'the sender';
            const intro = `On ${when}, ${who} wrote:`;
            // HTML-only emails (common from Gmail/phones) have no text part, so fall back to the HTML as text
            const origText = (p.text && p.text.trim()) ? p.text
              : stripHtml(p.html || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
            const quoted = origText.trimEnd().split(/\r?\n/).map(l => `> ${l.trim()}`).join('\n');
            text = `${text}\n\n${intro}\n${quoted}\n`;
            if (html) {
              const origHtml = p.html || `<pre>${escapeHtml(origText)}</pre>`;
              html = `${html}<br><br><div>${escapeHtml(intro)}</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${origHtml}</blockquote>`;
            }
          }

          const mailOptions = {
            from: fromForNodemailer(SMTP_CONFIG.auth.user),
            to,
            cc,
            bcc: args.bcc,
            subject,
            text,
            html,
            inReplyTo: p.messageId,
            references,
            attachments
          };

          let result;
          if (args.mode === 'send') {
            const info = await nodemailer.createTransport(SMTP_CONFIG).sendMail(mailOptions);
            // Mark the original as answered (shows the replied arrow in Proton)
            try { await connection.addFlags(requireUid(args.uid), ['\\Answered']); } catch { /* not critical */ }
            result = { success: true, sent: true, messageId: info.messageId, response: info.response };
          } else {
            const draftsFolder = await findDraftsFolder(connection);
            // Proton drops threading headers from drafts but keeps Message-ID, so remember them locally
            const messageId = newMessageId();
            const message = await buildRawMessage({ ...mailOptions, messageId, from: fromForNodemailer(IMAP_CONFIG.imap.user) });
            await connection.append(message, { mailbox: draftsFolder, flags: ['\\Draft'] });
            if (p.messageId) {
              const threading = loadThreading();
              threading[messageId] = { inReplyTo: p.messageId, references, savedAt: Date.now() };
              saveThreading(threading);
            }
            result = { success: true, sent: false, savedTo: draftsFolder, note: 'Send it with send_draft to keep it in the same thread' };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ...result,
                to,
                cc,
                subject,
                inReplyTo: p.messageId,
                attachments: attachments?.map(a => a.filename)
              }, null, 2)
            }]
          };
        } finally {
          connection.end();
        }
      }

      case 'delete_email': {
        const folder = args.folder || 'INBOX';
        const uid = requireUid(args.uid);
        const connection = await connectIMAP();

        try {
          const trash = await findTrashFolder(connection).catch(() => null);
          const inTrash = trash && folder.toLowerCase() === trash.toLowerCase();
          await connection.openBox(folder);

          const found = await connection.search([['UID', uid]], { bodies: ['HEADER.FIELDS (SUBJECT)'] }).catch(() => []);
          if (found.length === 0) throw new Error(`Email ${uid} not found in ${folder}, so nothing was deleted`);
          const subject = found[0].parts.find(p => p.which.includes('HEADER'))?.body?.subject?.[0] || '(no subject)';

          if (args.permanent || inTrash) {
            await connection.addFlags(uid, ['\\Deleted']);
            await connection.closeBox(true); // Expunge
            return { content: [{ type: 'text', text: `Permanently deleted "${subject}" from ${folder}. This cannot be undone.` }] };
          }

          if (!trash) throw new Error('Could not find a Trash folder, so nothing was deleted. Use permanent=true to erase it instead.');
          await connection.moveMessage(String(uid), trash);
          return { content: [{ type: 'text', text: `Moved "${subject}" from ${folder} to ${trash}. It can be restored from there.` }] };
        } finally {
          connection.end();
        }
      }

      case 'download_attachment': {
        const folder = args.folder || 'INBOX';
        const connection = await connectIMAP();

        try {
          await connection.openBox(folder);
          const original = await fetchParsed(connection, args.uid);
          if (!original) throw new Error(`Email ${args.uid} not found in ${folder}`);
          const all = original.parsed.attachments || [];
          if (all.length === 0) throw new Error('That email has no attachments');

          let chosen;
          if (args.index !== undefined && args.index !== null) {
            const idx = Number(args.index);
            if (!Number.isInteger(idx) || idx < 0 || idx >= all.length) {
              throw new Error(`No attachment at index ${JSON.stringify(args.index)} (this email has ${all.length}, numbered from 0)`);
            }
            chosen = [all[idx]];
          } else if (args.filename) {
            chosen = all.filter(a => (a.filename || '').toLowerCase() === args.filename.toLowerCase());
            if (chosen.length === 0) {
              throw new Error(`No attachment named "${args.filename}". Available: ${all.map(a => a.filename).join(', ')}`);
            }
          } else {
            chosen = all;
          }

          const dir = safeSaveDir(args.save_dir);
          const saved = chosen.map(a => {
            const target = uniqueSafePath(dir, a.filename);
            fs.writeFileSync(target, a.content, { flag: 'wx' });
            return { filename: a.filename, savedAs: target, size: a.size, contentType: a.contentType };
          });

          return { content: [{ type: 'text', text: JSON.stringify({ saved }, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

// Start server
async function main() {
  try {
    loadSecrets();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  validateConfig();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('IMAP Email MCP Server running on stdio');
}

// Exported only so the platform-specific safety rules can be tested; the server starts as usual.
// IMAP_MCP_NO_START=1 lets a test import this file without starting the server.
export { attachmentBlockReason, isInside, readStoredPassword, requireUid };

if (process.env.IMAP_MCP_NO_START !== '1') {
  main().catch(console.error);
}
