const $ = selector => document.querySelector(selector);
const apiKeyStore = "dtuCareerRadarTinyFishKey";
const form = $("#searchForm");
const modal = $("#keyModal");
let listings = [];
let profile = null;
let sortByFit = true;

function getKey() { return sessionStorage.getItem(apiKeyStore) || ""; }
function setKeyStatus() {
  const connected = Boolean(getKey());
  const label = $("#keyLabel");
  label.textContent = connected ? "CONNECTED" : "ADD";
  label.classList.toggle("connected", connected);
}
function notify(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.remove("hidden");
  clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.add("hidden"), 3000);
}
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
}
function safeHref(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : "#"; } catch { return "#"; }
}
function terms(value) { return String(value || "").split(/[,;\n]+/).map(item => item.trim()).filter(item => item.length > 1); }
function profileFromForm() {
  const data = new FormData(form);
  return {
    role: String(data.get("role") || "").trim(), location: String(data.get("location") || "").trim(),
    types: data.getAll("opportunityType"), experience: data.get("experience"), education: data.get("education"),
    skills: terms(data.get("skills")), industries: terms(data.get("industries")), workMode: data.get("workMode"),
    minimumPay: Number(data.get("minimumPay") || 0), availability: data.get("availability"), workAuth: data.get("workAuth"),
    linkedin: String(data.get("linkedin") || "").trim(), profileContext: String(data.get("profileContext") || "").trim()
  };
}
function searchPayloadFor(prefs) {
  // LinkedIn URL, pasted profile text, pay, work mode, and authorization stay in the browser.
  // Only the role, location, and relevant search terms are sent to the local server/TinyFish.
  return {
    role: prefs.role, location: prefs.location,
    keywords: [...prefs.skills, ...prefs.industries].join(", "),
    opportunityTypes: prefs.types,
    sources: ["greenhouse", "lever", "workday", "company"]
  };
}
function typeFor(job) {
  const text = `${job.jobType || ""} ${(job.tags || []).join(" ")} ${job.title || ""} ${job.snippet || ""}`.toLowerCase();
  if (/intern/.test(text)) return "Internship";
  if (/graduate|trainee/.test(text)) return "Graduate / trainee";
  if (/freelance|contractor/.test(text)) return /freelance/.test(text) ? "Freelance" : "Contract";
  if (/part[- ]time/.test(text)) return "Part-time";
  if (/contract/.test(text)) return "Contract";
  if (/full[- ]?time/.test(text)) return "Full-time";
  return job.jobType || "Not specified";
}
function workModeFor(job) {
  const text = `${job.workMode || ""} ${job.location || ""} ${(job.tags || []).join(" ")} ${job.snippet || ""}`.toLowerCase();
  if (/hybrid/.test(text)) return "Hybrid";
  if (/remote/.test(text)) return "Remote";
  if (/on.site|onsite|office based/.test(text)) return "On-site";
  return "Not stated";
}
function skillMatches(job, prefs) {
  const text = `${job.title} ${job.company} ${job.location} ${job.snippet} ${(job.tags || []).join(" ")}`.toLowerCase();
  return [...prefs.skills, ...prefs.industries].filter((skill, index, all) => all.findIndex(x => x.toLowerCase() === skill.toLowerCase()) === index && text.includes(skill.toLowerCase()));
}
function rankLocal(job, prefs) {
  const text = `${job.title} ${job.company} ${job.location} ${job.snippet} ${(job.tags || []).join(" ")}`.toLowerCase();
  const foundSkills = skillMatches(job, prefs);
  const roleHit = text.includes(prefs.role.toLowerCase()) || prefs.role.toLowerCase().split(/\s+/).some(word => word.length > 3 && text.includes(word));
  const normalizedText = text.replace(/gurugram/g, "gurgaon");
  const normalizedPlace = prefs.location.toLowerCase().replace(/gurugram/g, "gurgaon");
  const locationHit = !normalizedPlace || normalizedText.includes(normalizedPlace) || (workModeFor(job) === "Remote" && /india|remote/i.test(normalizedText));
  const workMode = workModeFor(job);
  const workModeHit = prefs.workMode === "Any" || workMode === "Not stated" || workMode === prefs.workMode;
  const jobType = typeFor(job);
  const typeHit = !prefs.types.length || prefs.types.includes(jobType) || jobType === "Not specified";
  const expText = `${job.title} ${job.snippet}`.toLowerCase();
  const educationText = `${job.title} ${job.snippet}`.toLowerCase();
  const educationHit = prefs.education === "Any" || prefs.education === "Any education" || educationText.includes(prefs.education.toLowerCase().replace("’", "'")) || /bachelor/.test(prefs.education.toLowerCase()) && /bachelor|degree|undergraduate/i.test(educationText);
  const expHit = prefs.experience === "Any" || prefs.experience === "Any experience" || expText.includes(prefs.experience.toLowerCase().replace(" years", "")) || job.seniority === "Any level";
  const profileWords = prefs.profileContext.toLowerCase().split(/[^a-z0-9+#.]+/).filter(word => word.length > 3);
  const contextHits = [...new Set(profileWords)].filter(word => text.includes(word)).slice(0, 4);
  const reasons = [];
  if (roleHit) reasons.push(`The listing title or description aligns with “${prefs.role}”.`);
  if (foundSkills.length) reasons.push(`Your skills appear in the listing: ${foundSkills.join(", ")}.`);
  else if (contextHits.length) reasons.push(`Your profile summary overlaps on: ${contextHits.join(", ")}.`);
  if (locationHit) reasons.push(`The location fits ${prefs.location || "your location preference"}${workMode === "Remote" ? " and the role is marked remote" : ""}.`);
  if (typeHit && prefs.types.length) reasons.push(`Opportunity type fits: ${jobType}.`);
  if (workModeHit && prefs.workMode !== "Any" && workMode !== "Not stated") reasons.push(`Work mode fits your ${prefs.workMode.toLowerCase()} preference.`);
  if (educationHit && prefs.education !== "Any" && prefs.education !== "Any education" && /bachelor|master|doctorate|degree/i.test(educationText)) reasons.push(`The listing mentions education that aligns with ${prefs.education}.`);
  if (prefs.minimumPay && job.salaryValue) reasons.push(job.salaryValue >= prefs.minimumPay ? `Listed pay appears to meet your ₹${prefs.minimumPay.toLocaleString("en-IN")} monthly minimum.` : "The stated pay appears below your minimum; review the original listing.");
  if (prefs.minimumPay && !job.salaryValue) reasons.push("Pay isn’t listed, so your minimum pay preference couldn’t be checked.");
  if (prefs.availability && prefs.availability !== "Any time" && /immediate|start date|available to start/i.test(text)) reasons.push("The listing includes a start or availability detail to compare with your timeline.");
  if (prefs.workAuth !== "Prefer not to say") reasons.push(/visa|sponsor/i.test(text) ? "The listing contains work-authorization or sponsorship details to check." : "The listing doesn’t clearly state sponsorship eligibility.");
  if (!reasons.length) reasons.push("This appeared in a live search for your role and industry. Check the details before applying.");
  let score = 42 + (roleHit ? 16 : 0) + Math.min(foundSkills.length * 7, 21) + Math.min(contextHits.length * 2, 8)
    + (locationHit ? 10 : -6) + (workModeHit ? 5 : -4) + (typeHit ? 5 : -4) + (expHit ? 4 : 0) + (educationHit ? 2 : 0);
  if (prefs.minimumPay && job.salaryValue) score += job.salaryValue >= prefs.minimumPay ? 5 : -6;
  if (prefs.workAuth === "Need visa sponsorship" && /visa|sponsor/i.test(text)) score += 4;
  job.jobType = jobType; job.workMode = workMode; job.matchedSkills = foundSkills; job.reasons = reasons;
  job.score = Math.max(35, Math.min(98, score));
  return job;
}
function formatPay(job) {
  if (job.salary) return job.salary;
  return "Pay not listed";
}
function postedLabel(job) { return job.posted || job.published_date || "Date not listed"; }
function filteredListings() {
  const query = $("#filterInput").value.trim().toLowerCase();
  const type = $("#typeFilter").value;
  const found = listings.filter(job => {
    const matchesType = type === "All" || job.jobType === type || job.jobType === "Not specified";
    const haystack = `${job.title} ${job.company} ${job.location} ${job.snippet} ${(job.tags || []).join(" ")}`.toLowerCase();
    return matchesType && (!query || haystack.includes(query));
  });
  return sortByFit ? found.sort((a, b) => b.score - a.score) : found.sort((a, b) => String(a.company).localeCompare(String(b.company)));
}
function whyMarkup(job, index) {
  const reasons = job.reasons || [];
  const unknowns = [];
  if (job.workMode === "Not stated") unknowns.push("The source page doesn’t clearly state a work mode.");
  if (job.fetchStatus === "Search snippet only") unknowns.push("TinyFish couldn’t read the full page; confirm all details on the employer site.");
  return `<div class="why-panel" id="why-${index}" hidden><b>Why this match?</b><ul>${reasons.map(reason => `<li>${escapeHTML(reason)}</li>`).join("")}${unknowns.map(reason => `<li>${escapeHTML(reason)}</li>`).join("")}</ul><button class="agent-check" type="button" data-agent-index="${index}">Ask TinyFish Agent to inspect this listing ↗</button><div class="agent-slot" id="agent-${index}"></div></div>`;
}
function cardMarkup(job, index) {
  const host = new URL(safeHref(job.url)).hostname;
  const skills = job.matchedSkills?.length ? job.matchedSkills : (job.tags || []).filter(tag => !/remote|hybrid|full.time|intern|visa/i.test(tag)).slice(0, 4);
  const tags = [job.jobType, job.workMode, job.seniority, formatPay(job)].filter((tag, i) => tag && tag !== "Not specified" && (i !== 1 || tag !== "Not stated"));
  return `<article class="job-card" style="animation-delay:${Math.min(index * 35, 210)}ms">
    <div class="job-card-top"><div><div class="job-company"><span class="company-avatar">${escapeHTML(String(job.company || "?").slice(0, 2).toUpperCase())}</span><span>${escapeHTML(job.company || host)}</span><span class="separator">·</span><span>${escapeHTML(job.location || "Location not listed")}</span></div><div class="job-subline"><h3 class="job-title">${escapeHTML(job.title)}</h3><span class="separator">·</span><span>${escapeHTML(host.replace(/^www\./, ""))}</span></div></div><span class="match-pill"><b>${job.score}</b> FIT</span></div>
    <div class="job-tags">${tags.map((tag, i) => `<span class="job-tag ${i === 0 ? "type" : i === 1 && /remote|hybrid/i.test(tag) ? "remote" : i === 3 && tag !== "Pay not listed" ? "pay" : ""}">${escapeHTML(tag)}</span>`).join("")}${job.posted ? `<span class="job-tag">${escapeHTML(job.posted)}</span>` : ""}</div>
    <p class="job-snippet">${escapeHTML(job.snippet || "Open the employer page to review the complete role description and application details.")}</p>
    ${skills.length ? `<div class="skill-tags">${skills.slice(0, 5).map(skill => `<span class="skill-tag">${escapeHTML(skill)}</span>`).join("")}</div>` : ""}
    <div class="job-card-bottom"><div class="match-actions"><button class="why-button" type="button" aria-expanded="false" data-why-index="${index}">Why this match? ⌄</button><span class="posted-time">${escapeHTML(postedLabel(job))}</span></div><a class="apply-button" href="${escapeHTML(safeHref(job.url))}" target="_blank" rel="noreferrer">View & apply ↗</a></div>${whyMarkup(job, index)}
  </article>`;
}
function renderFiltered() {
  const items = filteredListings();
  $("#resultsList").innerHTML = items.map(cardMarkup).join("");
  const noResults = listings.length > 0 && items.length === 0;
  $("#noFilterResults").classList.toggle("hidden", !noResults);
  $("#showingCount").textContent = listings.length ? `Showing ${items.length} of ${listings.length} matching opportunities` : "Set your preferences and search";
}
function renderResults(data) {
  const seenSkills = new Set(profile.skills.map(skill => skill.toLowerCase()));
  listings = (data.results || []).map(job => rankLocal(job, profile));
  if (sortByFit) listings.sort((a, b) => b.score - a.score);
  $("#matchCount").textContent = String(listings.length);
  $("#skillsCount").textContent = String(seenSkills.size);
  $("#sourceCount").textContent = String(data.fetched || 0);
  $("#freshness").innerHTML = `<i></i> UPDATED ${new Date(data.searchedAt || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("#freshness").classList.remove("searching"); $("#freshness").classList.add("updated");
  $("#emptyState").classList.add("hidden"); $("#loadingState").classList.add("hidden"); $("#errorState").classList.add("hidden");
  if (!listings.length) {
    $("#emptyState").classList.remove("hidden");
    $("#emptyState").innerHTML = `<div class="empty-orbit"><span>⌕</span></div><h3>No live opportunities found.</h3><p>${escapeHTML(data.message || "Try changing your role, location, or career sources and search again.")}</p>`;
  }
  renderFiltered();
}
async function runSearch() {
  if (!getKey()) { modal.classList.remove("hidden"); $("#apiKeyInput").focus(); notify("Connect your TinyFish API key to search live opportunities."); return; }
  profile = profileFromForm();
  const payload = searchPayloadFor(profile);
  $("#searchButton").disabled = true; $("#freshness").innerHTML = "<i></i> SEARCHING"; $("#freshness").classList.add("searching");
  $("#emptyState").classList.add("hidden"); $("#errorState").classList.add("hidden"); $("#resultsList").innerHTML = ""; $("#noFilterResults").classList.add("hidden");
  $("#loadingState").classList.remove("hidden");
  const timer = setTimeout(() => { $("#loadingText").textContent = "Reading live pages and building your ranked list…"; $(".loading-rail span:nth-of-type(2)").classList.add("active"); }, 2200);
  try {
    const response = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, apiKey: getKey() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Search failed (${response.status}).`);
    renderResults(data);
  } catch (error) {
    $("#loadingState").classList.add("hidden"); $("#errorState").classList.remove("hidden");
    $("#errorText").textContent = error.message || "Could not reach TinyFish.";
    $("#freshness").textContent = "SEARCH NEEDS ATTENTION"; $("#freshness").classList.remove("searching");
  } finally { clearTimeout(timer); $("#searchButton").disabled = false; }
}
async function verifyWithAgent(index) {
  const job = filteredListings()[index] || listings[index];
  const button = document.querySelector(`[data-agent-index="${index}"]`);
  const slot = $(`#agent-${index}`);
  if (!job || !button || !slot || button.disabled) return;
  button.disabled = true; button.textContent = "TinyFish Agent is reading this page…";
  slot.innerHTML = `<div class="agent-output">Inspecting the live job page…</div>`;
  try {
    const response = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listing: job, apiKey: getKey() }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Agent check failed.");
    let output = data.result; if (typeof output === "string") { try { output = JSON.parse(output); } catch {} }
    const summary = typeof output === "object" && output ? Object.entries(output).map(([key, value]) => `<div><b>${escapeHTML(key.replaceAll("_", " "))}:</b> ${escapeHTML(Array.isArray(value) ? value.join(", ") : value)}</div>`).join("") : escapeHTML(output);
    slot.innerHTML = `<div class="agent-output"><b>TINYFISH AGENT CHECK</b><div>${summary || "Page inspected. Confirm final details with the employer."}</div></div>`;
    button.textContent = "Agent checked ✓";
  } catch (error) { slot.innerHTML = `<div class="agent-output">${escapeHTML(error.message)}</div>`; button.disabled = false; button.textContent = "Retry Agent check ↗"; }
}
function updateSkillCount() { $("#skillsCount").textContent = String(new Set(terms($("#skills").value).map(x => x.toLowerCase())).size); }
function showHow() { notify("Fit combines role alignment, matching skills, location, opportunity type, work mode, and any details stated on the live listing. Scores are estimates."); }

form.addEventListener("submit", event => { event.preventDefault(); runSearch(); });
form.addEventListener("reset", () => setTimeout(() => { updateSkillCount(); $("#filterInput").value = ""; $("#typeFilter").value = "All"; }, 0));
$("#skills").addEventListener("input", updateSkillCount);
$("#filterInput").addEventListener("input", renderFiltered);
$("#typeFilter").addEventListener("change", renderFiltered);
$("#sortButton").addEventListener("click", () => { sortByFit = !sortByFit; $("#sortButton").innerHTML = sortByFit ? "BEST FIT <span>↕</span>" : "COMPANY A–Z <span>↕</span>"; renderFiltered(); });
$("#howButton").addEventListener("click", showHow);
$("#errorConnect").addEventListener("click", () => $("#keyButton").click());
$("#resultsList").addEventListener("click", event => {
  const whyButton = event.target.closest("[data-why-index]");
  if (whyButton) {
    const panel = $(`#why-${whyButton.dataset.whyIndex}`);
    const expanded = whyButton.getAttribute("aria-expanded") === "true";
    whyButton.setAttribute("aria-expanded", String(!expanded)); whyButton.textContent = expanded ? "Why this match? ⌄" : "Why this match? ⌃";
    panel.hidden = expanded;
  }
  const agentButton = event.target.closest("[data-agent-index]");
  if (agentButton) verifyWithAgent(Number(agentButton.dataset.agentIndex));
});
$("#keyButton").addEventListener("click", () => { $("#apiKeyInput").value = getKey(); modal.classList.remove("hidden"); $("#apiKeyInput").focus(); });
$("#closeModal").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", event => { if (event.target === modal) modal.classList.add("hidden"); });
$("#saveKey").addEventListener("click", () => {
  const key = $("#apiKeyInput").value.trim();
  if (!key) { notify("Paste your TinyFish key first."); return; }
  sessionStorage.setItem(apiKeyStore, key); setKeyStatus(); modal.classList.add("hidden"); notify("TinyFish connected for this browser session.");
});
$("#clearKey").addEventListener("click", () => { sessionStorage.removeItem(apiKeyStore); $("#apiKeyInput").value = ""; setKeyStatus(); notify("TinyFish key cleared from this browser session."); });
setKeyStatus(); updateSkillCount();
