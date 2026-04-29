// ============================================================
// templateEngine.js
// Loads HTML templates and replaces {{variables}} with data
// ============================================================

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/**
 * Load an HTML template file from the /templates folder
 * @param {string} templateName - filename without extension (e.g. "welcome")
 * @returns {string} raw HTML string with {{placeholders}}
 */
function loadTemplate(templateName) {
  const filePath = path.join(TEMPLATES_DIR, `${templateName}.html`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${filePath}\nMake sure the file exists in the /templates folder.`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Replace all {{variable}} placeholders in a template with real values
 * @param {string} template - raw HTML string
 * @param {object} variables - key/value pairs e.g. { name: "John", email: "john@example.com" }
 * @returns {string} HTML with all variables replaced
 */
function renderTemplate(template, variables = {}) {
  let rendered = template;

  // Replace each {{key}} with the matching value
  for (const [key, value] of Object.entries(variables)) {
    // Use a global regex to replace ALL occurrences of {{key}}
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    rendered = rendered.replace(regex, value || '');
  }

  // Find any remaining unreplaced {{variables}} and log a warning
  const unreplaced = rendered.match(/{{[^}]+}}/g);
  if (unreplaced) {
    console.warn(`⚠️  Unreplaced template variables: ${unreplaced.join(', ')}`);
  }

  return rendered;
}

/**
 * Full pipeline: load template + render with variables
 * @param {string} templateName - template filename (without .html)
 * @param {object} variables - data to inject
 * @returns {string} final HTML ready to send
 */
function getRenderedTemplate(templateName, variables = {}) {
  const raw = loadTemplate(templateName);
  return renderTemplate(raw, variables);
}

/**
 * List all available templates
 * @returns {string[]} array of template names (without .html)
 */
function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    return [];
  }
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => f.replace('.html', ''));
}

module.exports = {
  loadTemplate,
  renderTemplate,
  getRenderedTemplate,
  listTemplates,
};
