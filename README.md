# 📧 Bulk Email Automation System

A production-ready Mailchimp-like bulk email system built with Node.js and Brevo SMTP. Supports HTML templates, queue management, scheduling, and retry logic.

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Install dependencies
```bash
npm install
```

### Step 2: Set up environment
```bash
cp .env.example .env
```
Then open `.env` and fill in your Brevo SMTP credentials.

### Step 3: Get Brevo SMTP credentials
1. Go to [app.brevo.com](https://app.brevo.com)
2. Navigate to **Settings → SMTP & API → SMTP**
3. Copy your **Login** and **Master Password** (or create a new SMTP key)
4. Paste them into `.env` as `BREVO_SMTP_USER` and `BREVO_SMTP_PASS`

### Step 4: Send your first campaign
```bash
node src/scheduler.js --run-now
```

---

## 📁 Project Structure

```
bulk-email-system/
│
├── src/
│   ├── scheduler.js      ← Main entry point, runs campaigns
│   ├── mailer.js         ← SMTP connection & batch sending
│   ├── queue.js          ← Queue management (pending/sent/failed)
│   ├── templateEngine.js ← HTML template loader & variable engine
│   └── logger.js         ← Writes logs to /logs folder
│
├── templates/
│   ├── welcome.html      ← Welcome/onboarding email
│   ├── newsletter.html   ← Newsletter template
│   └── promotional.html  ← Discount/promo email
│
├── emailLists/
│   ├── subscribers.csv   ← CSV format (email, name, ...)
│   ├── test-list.txt     ← Plain text format
│   └── vip-list.json     ← JSON format
│
├── campaigns/
│   ├── welcome-campaign.json   ← Campaign config
│   ├── newsletter-may.json
│   └── black-friday.json
│
├── logs/                 ← Auto-created, stores send logs
├── .github/workflows/    ← GitHub Actions for server scheduling
├── .env.example          ← Copy to .env and fill in your values
└── package.json
```

---

## ⚙️ Configuration (.env)

| Variable | Description | Example |
|---|---|---|
| `BREVO_SMTP_USER` | Your Brevo login email | you@example.com |
| `BREVO_SMTP_PASS` | Your Brevo SMTP password/key | xsmtpsib-abc123 |
| `FROM_NAME` | Sender display name | My Company |
| `FROM_EMAIL` | Sender email address | hello@mycompany.com |
| `BATCH_SIZE` | Emails per batch run | 50 |
| `EMAIL_DELAY_MS` | Delay between emails (ms) | 1000 |
| `MAX_RETRIES` | Max retry attempts per email | 3 |
| `ACTIVE_CAMPAIGN` | Campaign filename (no .json) | welcome-campaign |
| `CRON_SCHEDULE` | Cron format for scheduling | 0 9 * * * |

---

## 📋 Commands

```bash
# Start cron scheduler (runs according to CRON_SCHEDULE in .env)
npm start

# Send one batch immediately
npm run send
# or:
node src/scheduler.js --run-now

# Retry all failed emails
npm run retry
# or:
node src/scheduler.js --retry-failed

# Check queue status
npm run status
# or:
node src/queue.js --status

# Load email list into queue (without sending)
node src/scheduler.js --init
```

---

## 📧 Email Templates

Templates are HTML files in the `/templates` folder. Use `{{variableName}}` for dynamic content.

### Built-in variables (always available)
| Variable | Value |
|---|---|
| `{{name}}` | Recipient's name |
| `{{email}}` | Recipient's email address |
| `{{year}}` | Current year |
| `{{date}}` | Today's date (formatted) |

### Custom variables
Add any variables in the campaign config under `defaultVariables`:
```json
{
  "defaultVariables": {
    "companyName": "My Company",
    "ctaUrl": "https://mysite.com"
  }
}
```

### Creating a new template
1. Create `templates/my-template.html`
2. Use `{{variableName}}` anywhere in the HTML
3. Set `"template": "my-template"` in your campaign config

---

## 📋 Campaign Config

Create a JSON file in `/campaigns`:

```json
{
  "name": "My Campaign Name",
  "subject": "Hello {{name}}, check this out!",
  "template": "welcome",
  "emailList": "subscribers.csv",
  "description": "Optional description",
  "defaultVariables": {
    "companyName": "My Company",
    "ctaUrl": "https://mysite.com",
    "ctaText": "Visit Now",
    "supportEmail": "support@mysite.com",
    "unsubscribeUrl": "https://mysite.com/unsubscribe",
    "privacyUrl": "https://mysite.com/privacy",
    "companyAddress": "123 Main St, City, Country"
  }
}
```

To use it, set in `.env`:
```
ACTIVE_CAMPAIGN=my-campaign
```

---

## 📂 Email List Formats

### CSV (recommended)
```csv
email,name,city
john@example.com,John Doe,New York
jane@example.com,Jane Smith,London
```

### TXT
```
John Doe <john@example.com>
jane@example.com
```

### JSON
```json
[
  { "email": "john@example.com", "name": "John Doe" },
  { "email": "jane@example.com", "name": "Jane Smith" }
]
```

---

## 🔄 Queue System

The queue is stored as `campaigns/<campaign-id>.queue.json`. Each email has one of these states:

| State | Meaning |
|---|---|
| `pending` | Ready to be sent |
| `sending` | Currently being sent |
| `sent` | Successfully delivered |
| `failed` | Failed (will retry up to MAX_RETRIES times) |

- **Duplicates are automatically prevented** — the same email is never added twice
- **Crash recovery** — if the app crashes mid-send, stuck "sending" emails are reset to "pending" on next start
- **Retry logic** — use `--retry-failed` to retry emails that failed

---

## ⏰ Scheduling

### Option 1: Cron on your server (Linux/Mac)
```bash
# Edit crontab
crontab -e

# Add this line to run every day at 9:00 AM
0 9 * * * cd /path/to/bulk-email-system && node src/scheduler.js --run-now >> /var/log/email-cron.log 2>&1
```

### Option 2: Node.js built-in scheduler
```bash
# Starts cron daemon based on CRON_SCHEDULE in .env
npm start
```

### Option 3: GitHub Actions (free, serverless)
1. Push this project to a GitHub repository
2. Go to **Settings → Secrets → Actions**
3. Add these secrets:
   - `BREVO_SMTP_USER`
   - `BREVO_SMTP_PASS`
   - `FROM_NAME`
   - `FROM_EMAIL`
   - `REPLY_TO`
   - `ACTIVE_CAMPAIGN`
4. The workflow in `.github/workflows/send-emails.yml` runs automatically

---

## 📊 Logs

Logs are stored in `/logs`:
- `logs/<campaign-id>.log` — per-campaign log
- `logs/combined.log` — all campaigns combined

Each line looks like:
```
[2025-05-01T09:00:01.234Z] [SENT          ] john@example.com (John Doe)
[2025-05-01T09:00:02.567Z] [FAILED        ] bad@email.com — Connection timeout
[2025-05-01T09:00:03.000Z] [BATCH_COMPLETE] Batch complete: 49 sent, 1 failed
```

---

## 🛡️ Best Practices

1. **Warm up your sending** — start with small batches (10-20) and increase gradually
2. **Verify your domain** — add SPF/DKIM DNS records for better deliverability
3. **Always include unsubscribe link** — required by law (CAN-SPAM, GDPR)
4. **Use delays** — keep `EMAIL_DELAY_MS` at 1000+ to avoid spam filters
5. **Monitor your Brevo dashboard** — check bounce rates and spam complaints

---

## 🔧 Troubleshooting

**SMTP connection failed**
- Double-check `BREVO_SMTP_USER` and `BREVO_SMTP_PASS` in `.env`
- Make sure you're using your Brevo **login email** as the user, not your domain email

**Emails going to spam**
- Set up SPF/DKIM records for your sending domain in Brevo
- Don't use spam trigger words in subject lines
- Start with small batches to build sender reputation

**Template variables not replacing**
- Make sure the variable name in `{{curlyBraces}}` matches exactly what's in `defaultVariables`
- Check for any typos in the template file

---

## 📄 License

MIT — free to use and modify.
