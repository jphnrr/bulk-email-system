// ============================================================
// scheduler.js
// Main entry point. Runs on a cron schedule OR manually.
//
// Usage:
//   node src/scheduler.js              → start cron daemon
//   node src/scheduler.js --run-now    → send immediately
//   node src/scheduler.js --retry-failed → retry failed emails
//   node src/scheduler.js --init       → load email list into queue
// ============================================================

require('dotenv').config();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const { runBatch } = require('./mailer');
const {
  initializeQueue,
  resetFailedToPending,
  recoverStuckEmails,
  getQueueStats,
} = require('./queue');
const logger = require('./logger');

const CAMPAIGNS_DIR = path.join(__dirname, '..', 'campaigns');

// ─── Load Campaign Config ──────────────────────────────────

/**
 * Load campaign configuration from /campaigns folder
 * @param {string} campaignId - matches filename (without .json)
 */
function loadCampaign(campaignId) {
  const filePath = path.join(CAMPAIGNS_DIR, `${campaignId}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Campaign config not found: ${filePath}\n` +
      `Create a file at campaigns/${campaignId}.json`
    );
  }

  const campaign = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Validate required fields
  if (!campaign.name) throw new Error('Campaign must have a "name" field');
  if (!campaign.subject) throw new Error('Campaign must have a "subject" field');
  if (!campaign.template) throw new Error('Campaign must have a "template" field');
  if (!campaign.emailList) throw new Error('Campaign must have an "emailList" field');

  return campaign;
}

// ─── Main Job Function ─────────────────────────────────────

/**
 * Run the full email sending pipeline for the active campaign
 */
async function runCampaign(options = {}) {
  const campaignId = process.env.ACTIVE_CAMPAIGN || 'welcome-campaign';

  console.log('\n' + '═'.repeat(50));
  console.log(`📨 Email Campaign Runner`);
  console.log(`   Campaign: ${campaignId}`);
  console.log(`   Time:     ${new Date().toLocaleString()}`);
  console.log('═'.repeat(50));

  let campaign;
  try {
    campaign = loadCampaign(campaignId);
    console.log(`✅ Campaign loaded: "${campaign.name}"`);
  } catch (err) {
    console.error('❌ Failed to load campaign:', err.message);
    return;
  }

  // Step 1: Recover any emails that got stuck as "sending" (crash recovery)
  recoverStuckEmails(campaignId);

  // Step 2: If retrying, reset failed emails to pending
  if (options.retryFailed) {
    const maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
    const reset = resetFailedToPending(campaignId, maxRetries);
    console.log(`🔄 Reset ${reset} failed emails to pending for retry`);
  }

  // Step 3: Initialize queue from email list (skips already-added emails)
  console.log(`\n📋 Loading email list: ${campaign.emailList}`);
  try {
    const result = initializeQueue(campaignId, campaign.emailList);
    console.log(`   ➕ Added ${result.added} new contacts`);
    console.log(`   ⏭️  Skipped ${result.skipped} (duplicates or invalid)`);
    console.log(`   📊 Total in queue: ${result.total}`);
  } catch (err) {
    console.error('❌ Failed to load email list:', err.message);
    logger.log(campaignId, 'ERROR', `Failed to load email list: ${err.message}`);
    return;
  }

  // Step 4: Show queue stats
  const stats = getQueueStats(campaignId);
  if (stats.pending === 0) {
    console.log('\n✅ No pending emails — all done or waiting for more contacts.');
    return;
  }

  console.log(`\n📬 ${stats.pending} emails pending`);

  // Step 5: Send the batch
  logger.log(campaignId, 'INFO', `Batch started at ${new Date().toISOString()}`);

  try {
    const result = await runBatch(campaignId, campaign);
    logger.log(
      campaignId,
      'INFO',
      `Batch finished: ${result.sent} sent, ${result.failed} failed`
    );
  } catch (err) {
    console.error('❌ Fatal error during batch:', err.message);
    logger.log(campaignId, 'ERROR', `Fatal batch error: ${err.message}`);
  }

  // Step 6: Batch delay if more emails remain
  const remaining = getQueueStats(campaignId);
  if (remaining.pending > 0) {
    const batchDelayMs = parseInt(process.env.BATCH_DELAY_MS) || 60000;
    console.log(`\n⏳ ${remaining.pending} emails still pending.`);
    console.log(`   Next batch in ${batchDelayMs / 1000}s (handled by scheduler)`);
  }
}

// ─── CLI Argument Handling ─────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--run-now')) {
  // Send immediately (one batch)
  console.log('▶️  Running immediately (--run-now)');
  runCampaign().then(() => {
    console.log('\n✅ Done.\n');
    process.exit(0);
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

} else if (args.includes('--retry-failed')) {
  // Retry all failed emails
  console.log('🔄 Retrying failed emails (--retry-failed)');
  runCampaign({ retryFailed: true }).then(() => {
    console.log('\n✅ Done.\n');
    process.exit(0);
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

} else if (args.includes('--init')) {
  // Just initialize the queue, don't send
  require('dotenv').config();
  const campaignId = process.env.ACTIVE_CAMPAIGN || 'welcome-campaign';
  const campaign = loadCampaign(campaignId);
  const result = initializeQueue(campaignId, campaign.emailList);
  console.log(`\n✅ Queue initialized for "${campaignId}"`);
  console.log(`   Added:   ${result.added}`);
  console.log(`   Skipped: ${result.skipped}`);
  console.log(`   Total:   ${result.total}\n`);
  process.exit(0);

} else {
  // Start cron daemon
  const schedule = process.env.CRON_SCHEDULE || '0 9 * * *';

  if (!cron.validate(schedule)) {
    console.error(`❌ Invalid cron schedule: "${schedule}"`);
    console.error('   Example valid schedules:');
    console.error('   "0 9 * * *"    → Every day at 9:00 AM');
    console.error('   "*/5 * * * *"  → Every 5 minutes');
    process.exit(1);
  }

  console.log(`\n⏰ Scheduler started`);
  console.log(`   Cron: "${schedule}"`);
  console.log(`   Next run: ${getNextRunTime(schedule)}`);
  console.log('   Press Ctrl+C to stop\n');

  cron.schedule(schedule, () => {
    console.log(`\n⏰ Cron triggered at ${new Date().toLocaleString()}`);
    runCampaign().catch(err => {
      console.error('Error in scheduled run:', err);
    });
  });

  // Also run once immediately on start if SEND_ON_START is set
  if (process.env.SEND_ON_START === 'true') {
    console.log('SEND_ON_START=true: Running immediately...');
    runCampaign().catch(console.error);
  }
}

/**
 * Get a human-readable time for the next cron run
 */
function getNextRunTime(schedule) {
  // Simple display — shows the schedule meaning
  const parts = schedule.split(' ');
  if (parts[0] === '0' && parts[1] && parts[2] === '*') {
    return `Daily at ${parts[1].padStart(2, '0')}:00`;
  }
  return schedule;
}
