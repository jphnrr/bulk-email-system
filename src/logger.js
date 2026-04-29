// ============================================================
// logger.js
// Writes logs to /logs folder for tracking sent/failed emails
// ============================================================

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Make sure /logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Write a log entry to the campaign's log file
 * @param {string} campaignId - campaign name (used as filename)
 * @param {string} level - 'SENT', 'FAILED', 'ERROR', 'INFO', 'BATCH_COMPLETE'
 * @param {string} message - log message
 */
function log(campaignId, level, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level.padEnd(14)}] ${message}\n`;

  // Write to campaign-specific log
  const logFile = path.join(LOGS_DIR, `${campaignId}.log`);
  fs.appendFileSync(logFile, logLine, 'utf8');

  // Also write to combined log
  const combinedLog = path.join(LOGS_DIR, 'combined.log');
  fs.appendFileSync(combinedLog, `[${campaignId}] ${logLine}`, 'utf8');
}

/**
 * Read the last N lines of a log file
 * @param {string} campaignId
 * @param {number} lines - how many lines to read from end
 */
function readLog(campaignId, lines = 50) {
  const logFile = path.join(LOGS_DIR, `${campaignId}.log`);

  if (!fs.existsSync(logFile)) {
    return '(no log file found)';
  }

  const content = fs.readFileSync(logFile, 'utf8');
  const allLines = content.trim().split('\n');
  return allLines.slice(-lines).join('\n');
}

/**
 * Get stats from log file: count of SENT vs FAILED
 */
function getLogStats(campaignId) {
  const logFile = path.join(LOGS_DIR, `${campaignId}.log`);

  if (!fs.existsSync(logFile)) {
    return { sent: 0, failed: 0, errors: 0 };
  }

  const content = fs.readFileSync(logFile, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);

  return {
    sent: lines.filter(l => l.includes('[SENT')).length,
    failed: lines.filter(l => l.includes('[FAILED')).length,
    errors: lines.filter(l => l.includes('[ERROR')).length,
    total: lines.length,
  };
}

module.exports = { log, readLog, getLogStats };
