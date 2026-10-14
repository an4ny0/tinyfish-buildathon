# DTU Career Radar

A local TinyFish-powered job and internship finder. It searches live employer career pages, reads the returned pages, ranks and deduplicates listings against a detailed career profile, and links to the original apply page. Users can filter results by role, company, skill, or opportunity type; expand “Why this match?” for a fit explanation; and ask the TinyFish Agent to inspect an individual result.

## Run it

Requires Node.js 20 or newer. No package install is required.

```sh
cd dtu-career-radar-demo
TINYFISH_API_KEY=your_key_here npm start
```

Open [http://localhost:4173](http://localhost:4173). Or start the server without the environment variable and paste a key into **API KEY** in the app. A key entered in the app stays in that browser session and is sent only to the local server.

Create a key at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys). Search and Fetch have free daily allowances; Agent checks use the TinyFish Agent API and may require wallet credits.

## TinyFish endpoints

- **Search** (`GET https://api.search.tinyfish.ai`) discovers listings across Greenhouse, Lever, Workday, and selected company career domains, with location and intent supplied from the form.
- **Fetch** (`POST https://api.fetch.tinyfish.ai`) reads up to ten discovered pages with live freshness (`ttl: 0`). The server combines extracted page content with Search fields, normalizes listing fields, removes duplicate company/title pairs, and ranks against role, location, seniority, keywords, and work authorization terms.
- **Agent** (`POST https://agent.tinyfish.ai/v1/automation/run`) is available as **AGENT CHECK** on each card. It visits that listing and returns a structured verification prompt for active status and application details.

The API key is never hardcoded in source or written to disk; the connection dialog holds it in browser session storage. The LinkedIn URL and pasted profile context stay in the browser and are used only by local matching logic. The search sends the target role, location, entered skills/industry terms, selected opportunity types, and API key to the local server; only the search terms and API key are passed to TinyFish. The app is designed for public hosting without a shared TinyFish secret: every visitor adds their own TinyFish key in the browser session. Do not set `TINYFISH_API_KEY` on a public deployment, since that would let visitors consume your personal quota.

## Publish a public website

This app includes `render.yaml` for Render. Push this folder to a GitHub repository, connect that repository in Render, and deploy it as a Web Service using the included Blueprint. Render assigns a public `onrender.com` address. The app listens on the deployment-provided port and `0.0.0.0`. The free service may sleep when idle and take a little time to wake on the next visit.

Each visitor must connect their own TinyFish API key to run live searches. Their key stays in that browser session and is sent to this app only with their search request; the server does not store it.

## Submission checklist

- Working demo: this runnable local application.
- Preferences: role, opportunity type, location, work mode, skills, industries, experience, education, pay, availability, and work authorization.
- Multiple live career sources: TinyFish Search is scoped across Greenhouse, Lever, Workday, and company sites.
- Structured deduplicated results: normalized fields, match score, source page and apply link.
- TinyFish explanation: in the app's “How the signal works” section and above.
- LinkedIn/X post: draft below; post it on both platforms and tag TinyFish to complete this submission requirement.

## Social post drafts

**LinkedIn** — Built DTU Career Radar at the TinyFish × DTU workshop: a live job and internship finder that searches employer career pages, reads listings, and ranks deduplicated results against your preferences. TinyFish Search discovers, Fetch reads the live source pages, and Agent can verify a listing on demand. Less refreshing career pages, more time finding the right role. Thanks @TinyFish AI!

**X** — Built DTU Career Radar at the TinyFish × DTU workshop: live job search across employer career pages, listings read with TinyFish Fetch, and on-demand verification with Agent. Ranked matches, real apply links, fewer stale tabs. @Tiny_Fish #TinyFish

## Implementation notes

Search and Fetch results are live API output and can vary by query, index freshness, and source-page accessibility. Search results without a close preference match are omitted to keep the shortlist relevant. Source sites remain authoritative for whether a role is open and for final application details.
