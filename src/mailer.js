// ============================================================
// mailer.js
// Handles SMTP connection via Brevo and sends emails
// Also manages batch sending with delays
// ============================================================

require('dotenv').config();
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const { getRenderedTemplate } = require('./templateEngine');
const {
  getPendingEmails,
  markAsSending,
  markAsSent,
  markAsFailed,
  getQueueStats,
} = require('./queue');
const logger = require('./logger');

// ─── SMTP Transporter ─────────────────────────────────────

/**
 * Create a Nodemailer transporter using Brevo SMTP
 */
function createTransporter() {
  const config = {
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.BREVO_SMTP_PORT) || 587,
    secure: false, // Use STARTTLS (not SSL)
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS,
    },
    // Connection timeout settings
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  };

  if (!config.auth.user || !config.auth.pass) {
    throw new Error(
      '❌ Missing Brevo SMTP credentials!\n' +
      'Make sure BREVO_SMTP_USER and BREVO_SMTP_PASS are set in your .env file.\n' +
      'Get them from: https://app.brevo.com/settings/keys/smtp'
    );
  }

  return nodemailer.createTransport(config);
}

/**
 * Test SMTP connection before sending
 */
async function verifyConnection() {
  const transporter = createTransporter();
  try {
    await transporter.verify();
    console.log('✅ SMTP connection verified successfully');
    return true;
  } catch (err) {
    console.error('❌ SMTP connection failed:', err.message);
    return false;
  }
}

// ─── Single Email Sender ───────────────────────────────────

/**
 * Send a single email
 * @param {object} transporter - nodemailer transporter
 * @param {object} options - { to, toName, subject, templateName, variables, html }
 */
async function sendEmail(transporter, options) {
  const { to, toName, subject, templateName, variables = {}, html } = options;

  // Build the HTML — either from a template or raw HTML
  let htmlContent;
  if (templateName) {
    // Add email and name to variables automatically
    const fullVariables = {
      name: toName || '',
      email: to,
      year: new Date().getFullYear(),
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      ...variables,
    };
    htmlContent = getRenderedTemplate(templateName, fullVariables);
  } else if (html) {
    htmlContent = html;
  } else {
    throw new Error('Either templateName or html must be provided');
  }

  // Build the plain-text version (strips HTML tags)
  const textContent = htmlContent
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const mailOptions = {
    from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
    replyTo: process.env.REPLY_TO || process.env.FROM_EMAIL,
    to: toName ? `"${toName}" <${to}>` : to,
    subject: subject,
    html: htmlContent,
    text: textContent,
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

// ─── Batch Sender ──────────────────────────────────────────

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run a batch of emails for a campaign
 * @param {string} campaignId - campaign name
 * @param {object} campaign - campaign config object
 * @returns {object} { sent, failed, skipped }
 */
async function runBatch(campaignId, campaign) {
  const batchSize = parseInt(process.env.BATCH_SIZE) || 50;
  const emailDelayMs = parseInt(process.env.EMAIL_DELAY_MS) || 1000;

  console.log(`\n🚀 Starting batch for campaign: "${campaign.name}"`);
  console.log(`   Template: ${campaign.template}`);
  console.log(`   Batch size: ${batchSize}`);

  // Verify SMTP before starting
  const connected = await verifyConnection();
  if (!connected) {
    logger.log(campaignId, 'ERROR', 'SMTP connection failed — batch aborted');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const transporter = createTransporter();
  const pending = getPendingEmails(campaignId, batchSize);

  if (pending.length === 0) {
    console.log('ℹ️  No pending emails in queue.');
    const stats = getQueueStats(campaignId);
    console.log(`   Stats: ${JSON.stringify(stats)}`);
    return { sent: 0, failed: 0, skipped: 0 };
  }

  console.log(`📧 Sending ${pending.length} emails...\n`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const progress = `[${i + 1}/${pending.length}]`;

    try {
      // Mark as in-progress
      markAsSending(campaignId, item.id);

      // Merge contact variables with campaign defaults
      const variables = {
        ...campaign.defaultVariables,
        ...item.variables,
        name: item.name,
        email: item.email,
      };

      await sendEmail(transporter, {
        to: item.email,
        toName: item.name,
        subject: campaign.subject,
        templateName: campaign.template,
        variables,
      });

      markAsSent(campaignId, item.id);
      logger.log(campaignId, 'SENT', `${item.email} (${item.name || 'no name'})`);
      console.log(`  ✅ ${progress} Sent → ${item.email}`);
      sent++;

    } catch (err) {
      markAsFailed(campaignId, item.id, err.message);
      logger.log(campaignId, 'FAILED', `${item.email} — ${err.message}`);
      console.error(`  ❌ ${progress} Failed → ${item.email}: ${err.message}`);
      failed++;
    }

    // Delay between emails (avoid spam filters)
    if (i < pending.length - 1) {
      await sleep(emailDelayMs);
    }
  }

  // Final summary
  const stats = getQueueStats(campaignId);
  const summary = `Batch complete: ${sent} sent, ${failed} failed | Queue: ${JSON.stringify(stats)}`;
  logger.log(campaignId, 'BATCH_COMPLETE', summary);

  console.log('\n' + '─'.repeat(50));
  console.log(`📊 Batch Complete:`);
  console.log(`   ✅ Sent:    ${sent}`);
  console.log(`   ❌ Failed:  ${failed}`);
  console.log(`   📊 Queue:   ${JSON.stringify(stats)}`);
  console.log('─'.repeat(50) + '\n');

  return { sent, failed };
}

module.exports = {
  createTransporter,
  verifyConnection,
  sendEmail,
  runBatch,
};
