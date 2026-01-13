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
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

// Configuration from environment variables
const IMAP_CONFIG = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || '993'),
    tls: process.env.IMAP_TLS !== 'false',
    authTimeout: parseInt(process.env.IMAP_AUTH_TIMEOUT || '10000'),
    tlsOptions: {
      rejectUnauthorized: process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false'
    }
  }
};

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER || process.env.IMAP_USER,
    pass: process.env.SMTP_PASSWORD || process.env.IMAP_PASSWORD
  }
};

// Validate required configuration
function validateConfig() {
  const required = ['IMAP_USER', 'IMAP_PASSWORD', 'IMAP_HOST'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
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
    version: '1.0.0',
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
        description: 'List emails from a folder with optional filtering',
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
              description: 'Only return emails since this date (YYYY-MM-DD format)'
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
        description: 'Search emails by subject, from, or body text',
        inputSchema: {
          type: 'object',
          properties: {
            folder: {
              type: 'string',
              description: 'Folder to search (default: INBOX)',
              default: 'INBOX'
            },
            subject: {
              type: 'string',
              description: 'Search in subject line'
            },
            from: {
              type: 'string',
              description: 'Search by sender'
            },
            body: {
              type: 'string',
              description: 'Search in body text'
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
            }
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
            }
          },
          required: ['uid', 'to', 'subject']
        }
      },
      {
        name: 'send_email',
        description: 'Send an email directly',
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
            }
          },
          required: ['to', 'subject']
        }
      },
      {
        name: 'delete_email',
        description: 'Delete an email by UID',
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
  const boxes = await connection.getBoxes();

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
          const boxes = await connection.getBoxes();
          const folders = [];

          function extractFolders(obj, prefix = '') {
            for (const [key, value] of Object.entries(obj)) {
              const fullPath = prefix ? `${prefix}.${key}` : key;
              folders.push(fullPath);
              if (value.children) {
                extractFolders(value.children, fullPath);
              }
            }
          }

          extractFolders(boxes);
          return { content: [{ type: 'text', text: JSON.stringify(folders, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'list_emails': {
        const folder = args.folder || 'INBOX';
        const limit = args.limit || 20;
        const connection = await connectIMAP();

        try {
          await connection.openBox(folder);

          let searchCriteria = ['ALL'];
          if (args.unseen_only) {
            searchCriteria = ['UNSEEN'];
          }
          if (args.since_date) {
            searchCriteria = [['SINCE', args.since_date]];
          }

          const fetchOptions = {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
            struct: true
          };

          const messages = await connection.search(searchCriteria, fetchOptions);
          const results = messages.slice(-limit).reverse().map(msg => {
            const header = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
            return {
              uid: msg.attributes.uid,
              date: header.date?.[0],
              from: header.from?.[0],
              to: header.to?.[0],
              subject: header.subject?.[0],
              flags: msg.attributes.flags
            };
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

          const messages = await connection.search([['UID', args.uid]], fetchOptions);

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
                attachments: parsed.attachments?.map(a => ({
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
        const folder = args.folder || 'INBOX';
        const limit = args.limit || 20;
        const connection = await connectIMAP();

        try {
          await connection.openBox(folder);

          let searchCriteria = [];
          if (args.subject) searchCriteria.push(['SUBJECT', args.subject]);
          if (args.from) searchCriteria.push(['FROM', args.from]);
          if (args.body) searchCriteria.push(['BODY', args.body]);

          if (searchCriteria.length === 0) {
            searchCriteria = ['ALL'];
          }

          const fetchOptions = {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
            struct: true
          };

          const messages = await connection.search(searchCriteria, fetchOptions);
          const results = messages.slice(-limit).reverse().map(msg => {
            const header = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
            return {
              uid: msg.attributes.uid,
              date: header.date?.[0],
              from: header.from?.[0],
              to: header.to?.[0],
              subject: header.subject?.[0]
            };
          });

          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'list_drafts': {
        const limit = args.limit || 20;
        const connection = await connectIMAP();

        try {
          const draftsFolder = await findDraftsFolder(connection);
          await connection.openBox(draftsFolder);

          const fetchOptions = {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
            struct: true
          };

          const messages = await connection.search(['ALL'], fetchOptions);
          const results = messages.slice(-limit).reverse().map(msg => {
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

          const messages = await connection.search([['UID', args.uid]], fetchOptions);

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

          // Build RFC 2822 compliant email message
          const boundary = `----=_Part_${Date.now()}`;
          let message = '';
          message += `From: ${IMAP_CONFIG.imap.user}\r\n`;
          message += `To: ${args.to}\r\n`;
          if (args.cc) message += `Cc: ${args.cc}\r\n`;
          if (args.bcc) message += `Bcc: ${args.bcc}\r\n`;
          message += `Subject: ${args.subject}\r\n`;
          message += `Date: ${new Date().toUTCString()}\r\n`;
          message += `MIME-Version: 1.0\r\n`;

          if (args.html) {
            message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
            message += `--${boundary}\r\n`;
            message += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
            message += `${args.body || ''}\r\n`;
            message += `--${boundary}\r\n`;
            message += `Content-Type: text/html; charset=utf-8\r\n\r\n`;
            message += `${args.html}\r\n`;
            message += `--${boundary}--\r\n`;
          } else {
            message += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
            message += `${args.body || ''}\r\n`;
          }

          await connection.append(message, { mailbox: draftsFolder, flags: ['\\Draft'] });

          return { content: [{ type: 'text', text: `Draft created successfully in ${draftsFolder}` }] };
        } finally {
          connection.end();
        }
      }

      case 'update_draft': {
        const connection = await connectIMAP();

        try {
          const draftsFolder = await findDraftsFolder(connection);
          await connection.openBox(draftsFolder);

          // Delete old draft
          await connection.addFlags(args.uid, ['\\Deleted']);
          await connection.closeBox(true); // Expunge

          // Create new draft
          await connection.openBox(draftsFolder);

          const boundary = `----=_Part_${Date.now()}`;
          let message = '';
          message += `From: ${IMAP_CONFIG.imap.user}\r\n`;
          message += `To: ${args.to}\r\n`;
          if (args.cc) message += `Cc: ${args.cc}\r\n`;
          if (args.bcc) message += `Bcc: ${args.bcc}\r\n`;
          message += `Subject: ${args.subject}\r\n`;
          message += `Date: ${new Date().toUTCString()}\r\n`;
          message += `MIME-Version: 1.0\r\n`;

          if (args.html) {
            message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
            message += `--${boundary}\r\n`;
            message += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
            message += `${args.body || ''}\r\n`;
            message += `--${boundary}\r\n`;
            message += `Content-Type: text/html; charset=utf-8\r\n\r\n`;
            message += `${args.html}\r\n`;
            message += `--${boundary}--\r\n`;
          } else {
            message += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
            message += `${args.body || ''}\r\n`;
          }

          await connection.append(message, { mailbox: draftsFolder, flags: ['\\Draft'] });

          return { content: [{ type: 'text', text: 'Draft updated successfully' }] };
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
          from: SMTP_CONFIG.auth.user,
          to: args.to,
          subject: args.subject,
          text: args.body,
          html: args.html,
          cc: args.cc,
          bcc: args.bcc
        };

        const info = await transporter.sendMail(mailOptions);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              messageId: info.messageId,
              response: info.response
            }, null, 2)
          }]
        };
      }

      case 'delete_email': {
        const folder = args.folder || 'INBOX';
        const connection = await connectIMAP();

        try {
          await connection.openBox(folder);
          await connection.addFlags(args.uid, ['\\Deleted']);
          await connection.closeBox(true); // Expunge

          return { content: [{ type: 'text', text: 'Email deleted successfully' }] };
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
  validateConfig();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('IMAP Email MCP Server running on stdio');
}

main().catch(console.error);
