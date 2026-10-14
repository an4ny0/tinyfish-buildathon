import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const boardGroups = {
  greenhouse: ["boards.greenhouse.io"],
  lever: ["jobs.lever.co"],
  workday: ["careers.workday.com", "myworkdayjobs.com"],
  company: ["amazon.jobs", "careers.google.com", "jobs.apple.com", "careers.microsoft.com", "careers.nvidia.com", "jobs.intel.com"]
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function bodyJson(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  if (text.length > 200_000) throw new Error("Request is too large.");
  return text ? JSON.parse(text) : {};
}

async function tinyfish(url, key, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "X-API-Key": key, "content-type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(90_000)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { error: raw.slice(0, 500) }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `TinyFish returned HTTP ${response.status}.`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return data;
}

function cleanText(value = "") { return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function unique(values) { return [...new Set(values.map(x => cleanText(x)).filter(Boolean))]; }
function isGenericCareerPage(title = "") {
  const value = cleanText(title).toLowerCase();
  return /^(careers?|search (?:for )?jobs?)(?:\b|\s|[-–—])/.test(value)
    || /^(software development|software engineering|job categories)$/.test(value)
    || /careers? (?:in|stage\b)/.test(value)
    || /^search jobs?\s*[-–—]/.test(value);
}

function normalizeListing(item, source = "TinyFish Search") {
  const url = item.url || item.apply_url || item.link;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const title = cleanText(item.title || item.role || item.job_title || "Opportunity");
  const snippet = cleanText([item.snippet, item.description, item.text, item.excerpt].filter(Boolean).join(" — ")).slice(0, 700);
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Careers site"; } })();
  const text = `${title} ${snippet} ${host}`;
  const companyMap = [["Google", /google/i], ["Amazon", /amazon/i], ["Apple", /apple/i], ["Microsoft", /microsoft/i], ["NVIDIA", /nvidia/i], ["Intel", /intel/i], ["Meta", /meta|facebook/i], ["Adobe", /adobe/i], ["Atlassian", /atlassian/i], ["Stripe", /stripe/i], ["Salesforce", /salesforce/i], ["Uber", /uber/i], ["Airbnb", /airbnb/i], ["Datadog", /datadog/i], ["Shopify", /shopify/i], ["LinkedIn", /linkedin/i], ["Chegg", /chegg/i], ["Nationwide", /nationwide/i], ["Visa", /visa/i]];
  const known = companyMap.find(([, regex]) => regex.test(`${host} ${text}`));
  const company = item.company || (known?.[0] === "google" ? "Google" : known?.[0]) || item.site_name || host.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const locationMatch = text.match(/(?:\*{0,2}locations?\*{0,2}|based in|office in)\s*[:\-]?\s*([^|.;\n]{2,70})/i);
  const locationText = cleanText(locationMatch?.[1] || "Location on listing").split(/(?:\s{2,}|\btime type\b|\bposted on\b|\bjob requisition id\b)/i)[0].slice(0, 48);
  const location = item.location && item.location !== "Location on listing" ? item.location : (/\bremote\b/i.test(text) ? "Remote" : locationText);
  const seniority = /intern(ship)?/i.test(text) ? "Internship" : /senior|staff|principal|lead/i.test(title) ? "Senior" : /junior|entry.level|graduate|associate/i.test(title) ? "Early career" : "Any level";
  const jobType = /intern(ship)?/i.test(text) ? "Internship" : /graduate|trainee/i.test(title) ? "Graduate / trainee" : /freelance/i.test(text) ? "Freelance" : /part[- ]time/i.test(text) ? "Part-time" : /contract/i.test(text) ? "Contract" : /full[- ]?time/i.test(text) ? "Full-time" : "Not specified";
  const workMode = /hybrid/i.test(text) ? "Hybrid" : /remote/i.test(text) ? "Remote" : /on.site|onsite/i.test(text) ? "On-site" : "Not stated";
  const salaryMatch = text.match(/(?:₹|INR|Rs\.?\s*)\s*([\d,]+(?:\.\d+)?)\s*(lpa|lakhs?|k)?/i);
  const salaryValue = salaryMatch ? Number(salaryMatch[1].replace(/,/g, "")) * (/lpa|lakhs?/i.test(salaryMatch[2] || "") ? 100000 / 12 : /^k$/i.test(salaryMatch[2] || "") ? 1000 : 1) : 0;
  const salary = salaryMatch ? `${salaryMatch[0].trim()}${/\/\s*(?:mo|month)/i.test(text) ? "/mo" : " (estimate from listing)"}` : "";
  const posted = cleanText(item.published_date || text.match(/posted\s+(?:today|yesterday|\d+\s+days?\s+ago|\d+\s+weeks?\s+ago|\d+\s+months?\s+ago)/i)?.[0] || "");
  const tags = unique([...(item.tags || []), jobType, workMode, /visa|sponsor/i.test(text) ? "Visa info found" : "Visa not stated"]);
  return { id: url.replace(/[?#].*$/, "").toLowerCase(), title, company, location, seniority, jobType, workMode, salary, salaryValue, posted, snippet: snippet.slice(0, 360), url, source, tags, updatedAt: new Date().toISOString(), score: 0, matched: [] };
}

function rank(listing, prefs) {
  const text = `${listing.title} ${listing.company} ${listing.location} ${listing.snippet} ${listing.tags.join(" ")}`.toLowerCase();
  const terms = unique([prefs.role, ...String(prefs.keywords || "").split(/[\s,;]+/), ...String(prefs.visa || "").split(/[\s,;]+/)]).map(t => t.toLowerCase()).filter(t => t.length > 1);
  const matched = terms.filter(t => text.includes(t));
  const loc = String(prefs.location || "").trim().toLowerCase();
  const locationHit = !loc || text.includes(loc) || /remote/i.test(text);
  const seniority = String(prefs.seniority || "Any");
  const seniorityHit = seniority === "Any" || listing.seniority === seniority || (seniority === "Early career" && /graduate|junior|entry|associate/i.test(text)) || (seniority === "Internship" && /intern/i.test(text));
  listing.score = Math.min(99, 46 + matched.length * 9 + (locationHit ? 14 : 0) + (seniorityHit ? 10 : 0));
  listing.matched = matched;
  listing.locationMatch = locationHit;
  listing.seniorityMatch = seniorityHit;
  return listing;
}

async function searchJobs(payload, key) {
  const role = cleanText(payload.role || "software engineer");
  const location = cleanText(payload.location || "India");
  const keywords = cleanText(payload.keywords || "");
  const desiredTypes = Array.isArray(payload.opportunityTypes) ? payload.opportunityTypes.join(" ") : "";
  const query = `${role} jobs ${location} ${keywords} ${desiredTypes} careers hiring`;
  const selectedSources = Array.isArray(payload.sources) ? payload.sources : Object.keys(boardGroups);
  const domains = unique(selectedSources.flatMap(source => boardGroups[source] || []));
  if (!domains.length) throw Object.assign(new Error("Choose at least one source group to search."), { status: 400 });
  const countryNames = { india:"IN", usa:"US", "united states":"US", us:"US", canada:"CA", uk:"GB", "united kingdom":"GB", germany:"DE", france:"FR", australia:"AU", japan:"JP", singapore:"SG" };
  const locationInput = location.toLowerCase();
  const country = Object.entries(countryNames).find(([name]) => locationInput === name || locationInput.endsWith(`, ${name}`))?.[1] || (/\b(US|IN|CA|GB|DE|FR|AU|JP|SG)\b/.exec(location)?.[1] || "US");
  const searchParams = new URLSearchParams({ query, location: country, language: "en", include_domains: domains.join(","), purpose: `Find current open job and internship listings matching role: ${role}; location: ${location}; keywords: ${keywords || "none"}. Prioritize company career pages and job application pages.` });
  const searchResult = await tinyfish(`https://api.search.tinyfish.ai?${searchParams}`, key);
  const searchRows = Array.isArray(searchResult.results) ? searchResult.results : [];
  const seen = new Set();
  const candidates = searchRows.filter(row => !isGenericCareerPage(row.title)).map(row => normalizeListing(row)).filter(row => {
    if (!row || seen.has(row.id)) return false;
    seen.add(row.id); return true;
  }).slice(0, 10);

  let fetched = [];
  let fetchErrors = [];
  if (candidates.length) {
    const fetchResult = await tinyfish("https://api.fetch.tinyfish.ai", key, { method: "POST", body: JSON.stringify({ urls: candidates.map(row => row.url), format: "markdown", ttl: 0, purpose: "Confirm this search result is an active job listing and extract role, location, job type, and application details." }) });
    fetched = Array.isArray(fetchResult.results) ? fetchResult.results : [];
    fetchErrors = Array.isArray(fetchResult.errors) ? fetchResult.errors : [];
  }
  const pageByUrl = new Map(fetched.map(page => [String(page.url || page.final_url).replace(/[?#].*$/, "").toLowerCase(), page]));
  const combined = candidates.map(candidate => {
    const page = pageByUrl.get(candidate.id);
    const pageText = cleanText(typeof page?.text === "string" ? page.text : "");
    const title = cleanText(page?.title || candidate.title);
    if (isGenericCareerPage(title)) return null;
    const listing = normalizeListing({ ...candidate, title, description: pageText.slice(0, 1200) || candidate.snippet, company: candidate.company }, "TinyFish Search + Fetch");
    listing.fetchStatus = page ? "Page read live" : "Search snippet only";
    return rank(listing, payload);
  });

  const normalized = new Map();
  for (const listing of combined.filter(Boolean)) {
    const key = `${listing.company.toLowerCase()}|${listing.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const old = normalized.get(key);
    if (!old || listing.score > old.score) normalized.set(key, listing);
  }
  const all = [...normalized.values()];
  const results = [...all].sort((a, b) => b.score - a.score).slice(0, 10);
  const fallback = results.some(row => !row.locationMatch || !row.seniorityMatch);
  return {
    query, results, totalFound: all.length, considered: searchRows.length, fetched: fetched.length, fallback,
    errors: fetchErrors.length, searchedAt: new Date().toISOString(),
    providers: ["TinyFish Search", ...(candidates.length ? ["TinyFish Fetch"] : [])],
    message: fallback ? "Some listing details may not match every preference. These are ranked live candidates; review each source page." : results.length ? "Ranked live openings. Open the source listing to apply." : "No listings found on the selected sources. Try broader keywords or another source group."
  };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
  if (url.pathname === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, configured: Boolean(process.env.TINYFISH_API_KEY) });
  if (url.pathname.startsWith("/api/")) {
    const input = await bodyJson(req);
    const key = process.env.TINYFISH_API_KEY || cleanText(input.apiKey || "");
    if (!key) return send(res, 401, { error: "Add a TinyFish API key in the key field or set TINYFISH_API_KEY before starting the server." });
    if (url.pathname === "/api/search" && req.method === "POST") {
      const data = await searchJobs(input, key);
      return send(res, 200, data);
    }
    if (url.pathname === "/api/agent" && req.method === "POST") {
      const listing = input.listing || {};
      let target;
      try { target = new URL(listing.url); } catch { return send(res, 400, { error: "Select a valid result URL first." }); }
      if (!/^https?:$/.test(target.protocol)) return send(res, 400, { error: "Only public HTTP(S) listings can be checked." });
      const goal = `Inspect this job listing page and verify whether it is a real job or internship opening. Return a concise JSON object with: title, company, location, employment_type, active (true/false/unknown), apply_url, and evidence (one short sentence). Do not invent missing details. Listing to inspect: ${listing.title || "job opportunity"}.`;
      const result = await tinyfish("https://agent.tinyfish.ai/v1/automation/run", key, { method: "POST", body: JSON.stringify({ url: target.href, goal }) });
      return send(res, 200, { result: result.result ?? result, status: result.status || "COMPLETED", runId: result.run_id || result.runId || null });
    }
    return send(res, 404, { error: "Unknown API route." });
  }
  const path = normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)).replace(/^([.][.][/\\])+/, "");
  try {
    const file = await readFile(join(root, "public", path));
    return send(res, 200, file, contentTypes[extname(path)] || "application/octet-stream");
  } catch { return send(res, 404, "Not found", "text/plain; charset=utf-8"); }
}

http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(error);
    send(res, error.status || 500, { error: error.message || "Unexpected server error." });
  });
}).listen(port, host, () => console.log(`DTU Career Radar is listening on ${host}:${port}`));
