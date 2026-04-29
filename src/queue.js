// ============================================================
// queue.js
// Manages the email queue: pending / sent / failed
// Prevents duplicate sends, supports retries
// Queue is stored as a JSON file so it survives restarts
// ============================================================

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parse/sync');

const CAMPAIGNS_DIR = path.join(__dirname, '..', 'campaigns');
const EMAIL_LISTS_DIR = path.join(__dirname, '..', 'emailLists');

// ─── Queue States ─────────────────────────────────────────
const STATUS = {
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
};

// ─── Queue File Management ────────────────────────────────

/**
 * Get the path to a campaign's queue file
 */
function getQueuePath(campaignId) {
  return path.join(CAMPAIGNS_DIR, `${campaignId}.queue.json`);
}

/**
 * Load queue from disk. Returns empty array if not found.
 */
function loadQueue(campaignId) {
  const queuePath = getQueuePath(campaignId);
  if (!fs.existsSync(queuePath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch (err) {
    console.error(`❌ Failed to load queue for ${campaignId}:`, err.message);
    return [];
  }
}

/**
 * Save queue to disk
 */
function saveQueue(campaignId, queue) {
  const queuePath = getQueuePath(campaignId);
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf8');
}

// ─── Email List Parsers ────────────────────────────────────

/**
 * Parse a .txt file (one email per line, or "Name <email>" format)
 */
function parseTxtList(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  return lines.map(line => {
    // Support "John Doe <john@example.com>" format
    const match = line.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    // Plain email address
    return { name: '', email: line };
  });
}

/**
 * Parse a .csv file (expects columns: email, name)
 */
function parseCsvList(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = csv.parse(content, {
    columns: true,           // use first row as column names
    skip_empty_lines: true,
    trim: true,
  });
  return records.map(row => ({
    name: row.name || row.Name || row.NAME || '',
    email: row.email || row.Email || row.EMAIL || '',
    // Include any extra columns as custom variables
    ...row,
  }));
}

/**
 * Parse a .json file (array of objects with at least { email } )
 */
function parseJsonList(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Auto-detect file type and parse email list
 */
function parseEmailList(filename) {
  const filePath = path.join(EMAIL_LISTS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Email list not found: ${filePath}`);
  }

  const ext = path.extname(filename).toLowerCase();

  if (ext === '.txt') return parseTxtList(filePath);
  if (ext === '.csv') return parseCsvList(filePath);
  if (ext === '.json') return parseJsonList(filePath);

  throw new Error(`Unsupported file type: ${ext}. Use .txt, .csv, or .json`);
}

// ─── Queue Builder ─────────────────────────────────────────

/**
 * Initialize a queue for a campaign from an email list.
 * Skips emails already in the queue (prevents duplicates).
 * @param {string} campaignId - campaign name (matches campaign JSON filename)
 * @param {string} emailListFile - filename in /emailLists folder
 * @returns {object} { added, skipped, total }
 */
function initializeQueue(campaignId, emailListFile) {
  const existing = loadQueue(campaignId);
  const existingEmails = new Set(existing.map(e => e.email.toLowerCase()));

  const contacts = parseEmailList(emailListFile);
  let added = 0;
  let skipped = 0;

  for (const contact of contacts) {
    if (!contact.email || !contact.email.includes('@')) {
      console.warn(`⚠️  Skipping invalid email: ${contact.email}`);
      skipped++;
      continue;
    }

    const emailLower = contact.email.toLowerCase();

    // Skip duplicates
    if (existingEmails.has(emailLower)) {
      skipped++;
      continue;
    }

    existing.push({
      id: uuidv4(),
      email: contact.email,
      name: contact.name || '',
      // Store any extra fields for template variables
      variables: contact,
      status: STATUS.PENDING,
      retries: 0,
      createdAt: new Date().toISOString(),
      sentAt: null,
      failedAt: null,
      error: null,
    });

    existingEmails.add(emailLower);
    added++;
  }

  saveQueue(campaignId, existing);
  return { added, skipped, total: existing.length };
}

// ─── Queue Operations ──────────────────────────────────────

/**
 * Get all pending emails (ready to be sent)
 */
function getPendingEmails(campaignId, limit = null) {
  const queue = loadQueue(campaignId);
  const pending = queue.filter(e => e.status === STATUS.PENDING);
  return limit ? pending.slice(0, limit) : pending;
}

/**
 * Get all failed emails that can still be retried
 */
function getRetryableEmails(campaignId, maxRetries = 3) {
  const queue = loadQueue(campaignId);
  return queue.filter(e => e.status === STATUS.FAILED && e.retries < maxRetries);
}

/**
 * Mark an email as "sending" (in-progress)
 */
function markAsSending(campaignId, emailId) {
  const queue = loadQueue(campaignId);
  const item = queue.find(e => e.id === emailId);
  if (item) {
    item.status = STATUS.SENDING;
    saveQueue(campaignId, queue);
  }
}

/**
 * Mark an email as successfully sent
 */
function markAsSent(campaignId, emailId) {
  const queue = loadQueue(campaignId);
  const item = queue.find(e => e.id === emailId);
  if (item) {
    item.status = STATUS.SENT;
    item.sentAt = new Date().toISOString();
    item.error = null;
    saveQueue(campaignId, queue);
  }
}

/**
 * Mark an email as failed (with error message)
 */
function markAsFailed(campaignId, emailId, errorMessage) {
  const queue = loadQueue(campaignId);
  const item = queue.find(e => e.id === emailId);
  if (item) {
    item.status = STATUS.FAILED;
    item.failedAt = new Date().toISOString();
    item.error = errorMessage;
    item.retries = (item.retries || 0) + 1;
    saveQueue(campaignId, queue);
  }
}

/**
 * Reset failed emails back to pending (for retry)
 */
function resetFailedToPending(campaignId, maxRetries = 3) {
  const queue = loadQueue(campaignId);
  let reset = 0;

  for (const item of queue) {
    if (item.status === STATUS.FAILED && item.retries < maxRetries) {
      item.status = STATUS.PENDING;
      reset++;
    }
  }

  saveQueue(campaignId, queue);
  return reset;
}

/**
 * Reset any "sending" emails back to pending
 * (handles crash recovery — if app crashed mid-send)
 */
function recoverStuckEmails(campaignId) {
  const queue = loadQueue(campaignId);
  let recovered = 0;

  for (const item of queue) {
    if (item.status === STATUS.SENDING) {
      item.status = STATUS.PENDING;
      recovered++;
    }
  }

  if (recovered > 0) {
    saveQueue(campaignId, queue);
    console.log(`🔄 Recovered ${recovered} stuck emails back to pending`);
  }

  return recovered;
}

// ─── Queue Stats ───────────────────────────────────────────

/**
 * Get a summary of the queue status
 */
function getQueueStats(campaignId) {
  const queue = loadQueue(campaignId);

  const stats = {
    total: queue.length,
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
  };

  for (const item of queue) {
    if (stats.hasOwnProperty(item.status)) {
      stats[item.status]++;
    }
  }

  return stats;
}

// ─── CLI: Show Status ──────────────────────────────────────
if (require.main === module && process.argv.includes('--status')) {
  require('dotenv').config();
  const campaignId = process.env.ACTIVE_CAMPAIGN || 'welcome-campaign';
  const stats = getQueueStats(campaignId);

  console.log('\n📊 Queue Status for campaign:', campaignId);
  console.log('─'.repeat(40));
  console.log(`  Total:   ${stats.total}`);
  console.log(`  Pending: ${stats.pending}`);
  console.log(`  Sending: ${stats.sending}`);
  console.log(`  Sent:    ${stats.sent}`);
  console.log(`  Failed:  ${stats.failed}`);
  console.log('─'.repeat(40) + '\n');
}

module.exports = {
  STATUS,
  initializeQueue,
  loadQueue,
  saveQueue,
  getPendingEmails,
  getRetryableEmails,
  markAsSending,
  markAsSent,
  markAsFailed,
  resetFailedToPending,
  recoverStuckEmails,
  getQueueStats,
};
