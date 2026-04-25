const { AIRouter, getProjectPreset } = require("ai-router");

const preset = getProjectPreset("4pro-identity");

const aiRouter = new AIRouter({
  ...preset,
  projectName: "4pro-identity",
});

/**
 * @param {object} options
 * @param {string} options.prompt - User prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.provider] - Provider override ('auto' by default)
 * @param {number} [options.maxTokens] - Max tokens
 * @param {number} [options.temperature] - Temperature
 * @param {boolean} [options.jsonMode] - JSON mode
 * @returns {Promise<import("ai-router").AIResponse>}
 */
async function routeAI(options) {
  const { prompt, systemPrompt, ...rest } = options;
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });
  return aiRouter.chat({ messages, ...rest });
}

module.exports = { aiRouter, router: aiRouter, routeAI };
