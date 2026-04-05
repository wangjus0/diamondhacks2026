import type { GoogleGenAI } from "@google/genai";
import { z } from "zod";

/**
 * Tool Guide — sits between intent classification and execution.
 * Given the user's request, determines the optimal execution strategy
 * using available Composio integrations + browser automation.
 */

// Curated list of high-value integrations grouped by category.
// We don't send all 978 to Gemini — just the ones most likely to be useful.
const INTEGRATION_CATALOG = `
## Available Integrations (via Composio)

### Email & Communication
- Gmail: read/send/search emails, manage labels
- Outlook: read/send emails, calendar integration
- Slack: send/read messages, manage channels
- Discord: send messages, manage servers
- Microsoft Teams: messaging, meeting scheduling
- WhatsApp: send/receive messages
- Telegram: send/receive messages

### Calendar & Scheduling
- Google Calendar: create/read/update events, check availability
- Calendly: manage scheduling links, check bookings
- Cal: open-source scheduling

### Productivity & Docs
- Google Docs: create/edit documents
- Google Sheets: read/write spreadsheet data
- Google Slides: create/edit presentations
- Google Drive: file management, sharing
- Notion: pages, databases, notes
- Todoist: task management
- Trello: board/card management
- Asana: project/task management
- ClickUp: project management
- Linear: issue tracking
- Jira: issue/project tracking

### Code & Dev
- GitHub: repos, issues, PRs, code search
- GitLab: repos, CI/CD
- Vercel: deployments, domains
- DigitalOcean: infrastructure

### Data & Search
- Google Maps: places, directions, geocoding
- Exa: AI-powered web search
- SerpApi: search engine results
- Wikipedia (via web): knowledge lookup
- Semantic Scholar: academic paper search
- Hacker News: tech news

### Finance & Payments
- Stripe: payment data, invoices
- QuickBooks: accounting
- Splitwise: expense splitting

### Social Media
- Twitter/X: posts, search, trends
- LinkedIn: profile, posts, job search
- Instagram: posts, stories
- Reddit: posts, comments, subreddit search
- YouTube: video search, channel data
- TikTok: content discovery

### CRM & Sales
- HubSpot: contacts, deals, companies
- Salesforce: CRM data
- Apollo: prospect data

### Food & Local
- Google Maps: restaurant/business search, reviews, directions
- Yelp (via web): reviews, ratings
- Instacart: grocery ordering

### Travel & Transport
- Google Maps: directions, transit, distances
- TripAdvisor: reviews, attractions
- Eventbrite: event discovery

### Education
- Google Classroom: assignments, courses
- Canvas: LMS integration

### Weather & Environment
- OpenWeatherMap: current/forecast weather
- Ambient Weather: station data

### Music & Entertainment
- Spotify: playlists, track search, playback
- Ticketmaster: event/concert tickets
- RAWG: video game database

### Browser Automation (always available)
- Direct web browsing: navigate any website, click, type, scroll, extract content
- Form filling: fill out web forms (draft mode by default)
- Multi-site comparison: compare data across multiple websites
- Web scraping: extract structured data from any page
`;

const toolPlanSchema = z.object({
  strategy: z.enum(["browser_only", "integration_assisted", "integration_direct"]),
  integrations: z.array(z.string()).describe("List of integration names to use"),
  enhanced_prompt: z.string().describe("Optimized task prompt for the browser agent"),
  reasoning: z.string().describe("Brief explanation of why this strategy was chosen"),
});

export type ToolPlan = z.infer<typeof toolPlanSchema>;

const TOOL_GUIDE_SYSTEM_PROMPT = `You are a tool routing expert for a voice-controlled AI assistant.

Given a user's request, determine the BEST execution strategy using the available integrations and browser automation.

${INTEGRATION_CATALOG}

## Strategy Types

1. **browser_only**: Use browser automation to navigate websites directly. Best for:
   - General web searches
   - Visiting specific websites
   - Tasks where no direct API integration exists
   - Reading/extracting content from web pages

2. **integration_assisted**: Use API integrations to ENHANCE browser automation. Best for:
   - Tasks that benefit from structured data (e.g., use Google Maps API for location data, then browser for details)
   - Multi-step workflows where some steps are better done via API
   - Tasks where API provides faster/more reliable data than scraping

3. **integration_direct**: Use API integrations directly WITHOUT browser automation. Best for:
   - Sending emails/messages (Gmail, Slack, etc.)
   - Calendar operations (create events, check availability)
   - CRUD operations on structured data (sheets, databases, CRM)
   - Tasks where the API provides everything needed

## Rules
- Always prefer integrations over browser scraping when both can accomplish the task
- For location/business queries: use Google Maps integration for structured data
- For email/messaging: always use direct integration (never browser)
- For scheduling: always use calendar integration (never browser)
- For code/dev tasks: use GitHub/GitLab integration
- The enhanced_prompt should be specific and actionable — include which sites to visit, what data to collect
- Keep reasoning to 1-2 sentences

Respond with JSON only:
{
  "strategy": "browser_only" | "integration_assisted" | "integration_direct",
  "integrations": ["integration_name", ...],
  "enhanced_prompt": "detailed task prompt",
  "reasoning": "why this strategy"
}`;

const FALLBACK_PLAN: ToolPlan = {
  strategy: "browser_only",
  integrations: [],
  enhanced_prompt: "",
  reasoning: "Fallback — using browser automation.",
};

export async function generateToolPlan(
  ai: GoogleGenAI,
  userRequest: string,
  intent: string,
  historyContext?: string
): Promise<ToolPlan> {
  try {
    const contextSection = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${TOOL_GUIDE_SYSTEM_PROMPT}\n\n` +
        `${contextSection}` +
        `User request: "${userRequest}"\n` +
        `Classified intent: ${intent}`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) return { ...FALLBACK_PLAN, enhanced_prompt: userRequest };

    const parsed = toolPlanSchema.parse(JSON.parse(text));
    return parsed;
  } catch (err) {
    console.error("[ToolGuide] Planning failed:", err);
    return { ...FALLBACK_PLAN, enhanced_prompt: userRequest };
  }
}
