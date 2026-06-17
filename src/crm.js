import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signOut, updatePassword } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import readXlsxFile from "read-excel-file/browser";
import { auth, db, storage } from "./firebase.js";
import {
  authorityTriggers,
  bigSpaceTriggers,
  budgetTriggers,
  dropdowns,
  inactiveStages,
  lostStages,
  strongPainTriggers,
  tableFields,
} from "./crm-config.js";

const appShell = document.querySelector("[data-crm-app]");
const loadingScreen = document.querySelector("[data-loading-screen]");
const userEmail = document.querySelector("[data-user-email]");
const logoutButton = document.querySelector("[data-logout]");
const settingsButton = document.querySelector("[data-open-settings]");
const leadRows = document.querySelector("[data-lead-rows]");
const followupList = document.querySelector("[data-followup-list]");
const addLeadButton = document.querySelector("[data-add-lead]");
const importLeadsButton = document.querySelector("[data-import-leads]");
const importFileInput = document.querySelector("[data-import-file]");
const importStatus = document.querySelector("[data-import-status]");
const leadDialog = document.querySelector("[data-lead-dialog]");
const leadForm = document.querySelector("[data-lead-form]");
const passwordDialog = document.querySelector("[data-password-dialog]");
const passwordForm = document.querySelector("[data-password-form]");
const passwordStatus = document.querySelector("[data-password-status]");
const searchInput = document.querySelector("[data-search]");
const leadSortSelect = document.querySelector("[data-lead-sort]");
const dashboardRange = document.querySelector("[data-dashboard-range]");
const metricsNode = document.querySelector("[data-metrics]");
const stageBreakdownNode = document.querySelector("[data-stage-breakdown]");
const sourceBreakdownNode = document.querySelector("[data-source-breakdown]");
const stageEventsNode = document.querySelector("[data-stage-events]");
const loadingText = loadingScreen?.querySelector("p");
const loadingLogin = document.querySelector("[data-loading-login]");
const menuToggles = document.querySelectorAll("[data-menu-toggle]");
const sidebarClose = document.querySelector("[data-sidebar-close]");
const sidebarOverlay = document.querySelector("[data-sidebar-overlay]");

let leads = [];
let leadsCollection = null;
let unsubscribeLeads = null;
let searchTerm = "";
let leadSortMode = "alphabetical";

const fieldOptions = {
  source: "sources",
  stage: "stages",
  owner: "owners",
  pain: "pains",
  spaceNeeded: "spaces",
  decisionMaker: "decisionMakers",
  budget: "budgets",
  city: "cities",
  lostReason: "lostReasons",
};

const dateFields = new Set(["deadline", "lastTouch", "nextFollowUpDate"]);
const textareaFields = new Set(["notes"]);
const fieldLabels = {
  name: "Lead",
  phone: "Phone",
  email: "Email",
  source: "Source",
  stage: "Stage",
  owner: "Owner",
  pain: "Pain",
  spaceNeeded: "Space",
  deadline: "Deadline",
  decisionMaker: "Decision",
  budget: "Budget",
  city: "City",
  score: "Score",
  lastTouch: "Last Touch",
  nextFollowUpDate: "Follow Up",
  lostReason: "Lost Reason",
  notes: "Notes",
  attachment: "Attachment",
};

const inferredStagePaths = {
  "Not Contacted Yet": ["Not Contacted Yet"],
  "Contacted / Replied": ["Contacted / Replied"],
  Qualified: ["Contacted / Replied", "Qualified"],
  "Asked for Pictures": ["Contacted / Replied", "Qualified", "Asked for Pictures"],
  "Offered Times": ["Contacted / Replied", "Qualified", "Asked for Pictures", "Offered Times"],
  "Booked Consult": ["Contacted / Replied", "Qualified", "Asked for Pictures", "Offered Times", "Booked Consult"],
  "Showed to Consult": [
    "Contacted / Replied",
    "Qualified",
    "Asked for Pictures",
    "Offered Times",
    "Booked Consult",
    "Showed to Consult",
  ],
  Closed: [
    "Contacted / Replied",
    "Qualified",
    "Asked for Pictures",
    "Offered Times",
    "Booked Consult",
    "Showed to Consult",
    "Closed",
  ],
  "Nurture After Consult": [
    "Contacted / Replied",
    "Qualified",
    "Asked for Pictures",
    "Offered Times",
    "Booked Consult",
    "Showed to Consult",
    "Nurture After Consult",
  ],
  "No for Now": [
    "Contacted / Replied",
    "Qualified",
    "Asked for Pictures",
    "Offered Times",
    "Booked Consult",
    "Showed to Consult",
    "No for Now",
  ],
  "Repeat Customer": [
    "Contacted / Replied",
    "Qualified",
    "Asked for Pictures",
    "Offered Times",
    "Booked Consult",
    "Showed to Consult",
    "Closed",
    "Repeat Customer",
  ],
  Lost: ["Lost"],
  Dead: ["Dead"],
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function timestampValue(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function isPastDue(lead) {
  if (!lead.nextFollowUpDate || inactiveStages.has(lead.stage)) return false;
  const due = toDate(`${lead.nextFollowUpDate}T00:00:00`);
  const today = toDate(`${todayISO()}T00:00:00`);
  return due && today && due < today;
}

function isDue(lead) {
  if (!lead.nextFollowUpDate || inactiveStages.has(lead.stage)) return false;
  const due = toDate(`${lead.nextFollowUpDate}T00:00:00`);
  return Boolean(due);
}

function isTimelineTrigger(value) {
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  if (["asap", "this week", "this month"].includes(normalized)) return true;
  const date = toDate(`${value}T00:00:00`);
  if (!date) return false;
  const today = toDate(`${todayISO()}T00:00:00`);
  const pastWindow = new Date(today);
  pastWindow.setDate(today.getDate() - 7);
  const futureWindow = new Date(today);
  futureWindow.setDate(today.getDate() + 30);
  return date >= pastWindow && date <= futureWindow;
}

function scoreLead(lead) {
  const score =
    Number(strongPainTriggers.has(lead.pain)) +
    Number(bigSpaceTriggers.has(lead.spaceNeeded)) +
    Number(authorityTriggers.has(lead.decisionMaker)) +
    Number(budgetTriggers.has(lead.budget)) +
    Number(isTimelineTrigger(lead.deadline));

  if (score >= 4) return { score, label: `Green (${score}/5)`, color: "green" };
  if (score >= 2) return { score, label: `Yellow (${score}/5)`, color: "yellow" };
  return { score, label: `Red (${score}/5)`, color: "red" };
}

function optionMarkup(options, selected = "") {
  return `<option value=""></option>${options
    .map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`)
    .join("")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeLead(snapshotDoc) {
  return {
    id: snapshotDoc.id,
    name: "",
    phone: "",
    email: "",
    source: "",
    stage: "Not Contacted Yet",
    owner: "Unassigned",
    pain: "",
    spaceNeeded: "",
    deadline: "",
    decisionMaker: "",
    budget: "",
    city: "",
    lastTouch: "",
    nextFollowUpDate: "",
    lostReason: "",
    notes: "",
    stageHistory: [],
    ...snapshotDoc.data(),
  };
}

function eventDateInRange(value, range) {
  if (range === "all") return true;
  const date = toDate(`${value}T00:00:00`) || toDate(value);
  if (!date) return false;
  const now = new Date();
  if (range === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return date >= start;
  }
  if (range === "month") {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
  if (range === "year") {
    return date.getFullYear() === now.getFullYear();
  }
  return true;
}

function getCountedCloseEvents(lead) {
  const history = Array.isArray(lead.stageHistory) ? lead.stageHistory : [];
  let lastLostIndex = -1;

  history.forEach((event, index) => {
    if (lostStages.has(event.stage)) {
      lastLostIndex = index;
    }
  });

  return history
    .slice(lastLostIndex + 1)
    .filter((event) => event.stage === "Closed")
    .map((event) => ({
      ...event,
      amount: Number(event.amount || 0),
      leadName: lead.name,
    }));
}

function fillDialogOptions() {
  document.querySelectorAll("[data-options]").forEach((select) => {
    select.innerHTML = optionMarkup(dropdowns[select.dataset.options] || []);
  });
}

function renderTable() {
  const visibleLeads = leads
    .filter((lead) => {
      const haystack = [lead.name, lead.phone, lead.email, lead.source, lead.stage, lead.owner, lead.city].join(" ").toLowerCase();
      return haystack.includes(searchTerm);
    })
    .sort(sortLeads);

  if (!visibleLeads.length) {
    leadRows.innerHTML = `<tr><td colspan="19">No leads yet. Add your first lead to start tracking.</td></tr>`;
    return;
  }

  leadRows.innerHTML = visibleLeads
    .map((lead) => {
      const score = scoreLead(lead);
      return `
        <tr data-lead-id="${lead.id}">
          ${renderEditableCell(lead, "name")}
          ${renderEditableCell(lead, "phone")}
          ${renderEditableCell(lead, "email")}
          ${renderEditableCell(lead, "source")}
          ${renderEditableCell(lead, "stage")}
          ${renderEditableCell(lead, "owner")}
          ${renderEditableCell(lead, "pain")}
          ${renderEditableCell(lead, "spaceNeeded")}
          ${renderEditableCell(lead, "deadline")}
          ${renderEditableCell(lead, "decisionMaker")}
          ${renderEditableCell(lead, "budget")}
          ${renderEditableCell(lead, "city")}
          <td data-label="${fieldLabels.score}"><span class="score-pill ${score.color}">${score.label}</span></td>
          ${renderEditableCell(lead, "lastTouch")}
          <td data-label="${fieldLabels.nextFollowUpDate}" class="${isPastDue(lead) ? "is-overdue" : ""}">${renderEditableCellInner(lead, "nextFollowUpDate")}</td>
          ${renderEditableCell(lead, "lostReason")}
          ${renderEditableCell(lead, "notes")}
          <td data-label="${fieldLabels.attachment}">${renderAttachment(lead)}</td>
          <td data-label="Delete"><button class="delete-lead-button" type="button" data-delete-lead>Delete</button></td>
        </tr>
      `;
    })
    .join("");
}

function sortLeads(a, b) {
  if (leadSortMode === "recently-added") {
    return timestampValue(b.createdAt) - timestampValue(a.createdAt) || String(a.name || "").localeCompare(String(b.name || ""));
  }

  if (leadSortMode === "recently-edited") {
    return timestampValue(b.updatedAt) - timestampValue(a.updatedAt) || String(a.name || "").localeCompare(String(b.name || ""));
  }

  return String(a.name || "").localeCompare(String(b.name || ""));
}

function renderEditableCell(lead, field) {
  return `<td data-label="${fieldLabels[field] || field}">${renderEditableCellInner(lead, field)}</td>`;
}

function renderEditableCellInner(lead, field) {
  const value = lead[field] || "";

  if (fieldOptions[field]) {
    return `<select data-field="${field}">${optionMarkup(dropdowns[fieldOptions[field]], value)}</select>`;
  }

  if (dateFields.has(field)) {
    return `<input data-field="${field}" type="date" value="${escapeHtml(value)}" />`;
  }

  if (textareaFields.has(field)) {
    return `<textarea data-field="${field}">${escapeHtml(value)}</textarea>`;
  }

  const type = field === "email" ? "email" : "text";
  return `<input data-field="${field}" type="${type}" value="${escapeHtml(value)}" />`;
}

function renderAttachment(lead) {
  const link = lead.attachmentUrl
    ? `<a class="attachment-link" href="${escapeHtml(lead.attachmentUrl)}" target="_blank" rel="noreferrer">${escapeHtml(lead.attachmentName || "View file")}</a>`
    : `<span class="empty-state">No file</span>`;

  return `
    <div class="attachment-control">
      ${link}
      <label class="attachment-upload">
        Upload
        <input data-attachment-upload type="file" />
      </label>
    </div>
  `;
}

function renderFollowups() {
  const queue = leads
    .filter(isDue)
    .sort((a, b) => String(a.nextFollowUpDate).localeCompare(String(b.nextFollowUpDate)));

  if (!queue.length) {
    followupList.innerHTML = `<div class="queue-card"><div><h3>No follow-ups due</h3><p>Add a follow-up date on a lead to populate this queue.</p></div></div>`;
    return;
  }

  followupList.innerHTML = queue
    .map((lead) => {
      const score = scoreLead(lead);
      return `
        <article class="queue-card" data-lead-id="${lead.id}">
          <div class="queue-card__lead">
            <h3>${escapeHtml(lead.name || "Unnamed Lead")}</h3>
            <p>${escapeHtml(lead.owner || "Unassigned")}</p>
          </div>
          <div class="queue-card__status">
            <p class="followup-step">Follow-up update</p>
            <label class="followup-check">
              <input type="checkbox" data-followup-confirm />
              <span>Yes, I followed up</span>
            </label>
            <div class="followup-details" data-followup-details hidden>
              <label>
                When did you follow up?
                <input type="date" data-followup-date />
              </label>
              <div class="followup-next-step" data-next-followup-step hidden>
                <label>
                  When is the next follow-up?
                  <input type="date" data-next-followup-date />
                </label>
                <button type="button" data-complete-followup>Save Follow-Up</button>
              </div>
            </div>
          </div>
          <div class="queue-card__meta">
            <span class="stage-pill">${escapeHtml(lead.stage || "")}</span>
            <span class="score-pill ${score.color}">${score.label}</span>
            <span class="date-pill ${isPastDue(lead) ? "overdue" : ""}">${formatDate(lead.nextFollowUpDate)}</span>
          </div>
          <div class="queue-card__notes-panel">
            <p class="queue-card__notes-label">Notes</p>
            <textarea class="queue-card__notes" data-field="notes" rows="2">${escapeHtml(lead.notes || "")}</textarea>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDashboard() {
  try {
    const range = dashboardRange.value;
    const leadsInRange = leads.filter((lead) => eventDateInRange(lead.createdAt?.toDate?.() || lead.createdAt || todayISO(), range));
    const stageEvents = leads.flatMap((lead) =>
      (lead.stageHistory || []).map((event) => ({
        ...event,
        leadId: lead.id,
        leadName: lead.name,
      })),
    );
    const eventsInRange = stageEvents.filter((event) => eventDateInRange(event.date, range));
    const reachedStageCounts = countDashboardReachedStages(leadsInRange, eventsInRange);
    const closeEvents = leads.flatMap(getCountedCloseEvents).filter((event) => eventDateInRange(event.date, range));
    const closedRevenue = closeEvents.reduce((total, event) => total + Number(event.amount || 0), 0);
    const dueCount = leads.filter((lead) => isDue(lead) && (isPastDue(lead) || lead.nextFollowUpDate === todayISO())).length;
    const greenCount = leadsInRange.filter((lead) => scoreLead(lead).color === "green").length;
    const bookedCount = reachedStageCounts["Booked Consult"] || 0;
    const showedCount = reachedStageCounts["Showed to Consult"] || 0;

    const metrics = [
      ["Total Leads", leadsInRange.length],
      ["Green Leads", greenCount],
      ["Booked Consults", bookedCount],
      ["Showed", showedCount],
      ["Counted Closes", closeEvents.length],
      ["Close Rate", showedCount ? `${Math.round((closeEvents.length / showedCount) * 100)}%` : "0%"],
      ["Closed Revenue", formatMoney(closedRevenue)],
      ["AOV", closeEvents.length ? formatMoney(closedRevenue / closeEvents.length) : "$0"],
      ["Follow-Ups Due", dueCount],
    ];

    metricsNode.innerHTML = metrics.map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
    stageBreakdownNode.innerHTML = renderBreakdown(reachedStageCounts, dropdowns.stages);
    sourceBreakdownNode.innerHTML = renderBreakdown(countBy(leadsInRange, "source"));
    stageEventsNode.innerHTML = eventsInRange.length
      ? eventsInRange
          .slice()
          .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
          .slice(0, 12)
          .map(
            (event) => `
              <div class="event-row">
                <span>${escapeHtml(event.leadName || "Lead")}: <strong>${escapeHtml(event.stage || "Unknown")}</strong></span>
                <span>${formatDate(event.date)}</span>
              </div>
            `,
          )
          .join("")
      : `<div class="event-row"><span>No stage events in this range.</span></div>`;
  } catch (error) {
    console.error(error);
    metricsNode.innerHTML = `<div class="metric-card"><span>Dashboard Error</span><strong>Refresh</strong></div>`;
    stageBreakdownNode.innerHTML = `<div class="breakdown-row"><span>Dashboard data could not load.</span></div>`;
    sourceBreakdownNode.innerHTML = `<div class="breakdown-row"><span>Dashboard data could not load.</span></div>`;
    stageEventsNode.innerHTML = `<div class="event-row"><span>Dashboard data could not load.</span></div>`;
  }
}

function getReachedStages(lead) {
  const reached = new Set(inferredStagePaths[lead.stage] || [lead.stage || "Blank"]);
  const history = Array.isArray(lead.stageHistory) ? lead.stageHistory : [];

  history.forEach((event) => {
    const stages = inferredStagePaths[event.stage] || [event.stage];
    stages.forEach((stage) => {
      if (stage) reached.add(stage);
    });
  });

  return [...reached];
}

function countDashboardReachedStages(leadsInRange, eventsInRange) {
  const stagesByLead = new Map();

  leadsInRange.forEach((lead) => {
    stagesByLead.set(lead.id, new Set(getReachedStages(lead)));
  });

  eventsInRange.forEach((event) => {
    const leadKey = event.leadId || `${event.leadName || "lead"}-${event.createdAt || event.date || ""}`;
    const stages = stagesByLead.get(leadKey) || new Set();
    (inferredStagePaths[event.stage] || [event.stage]).forEach((stage) => {
      if (stage) stages.add(stage);
    });
    stagesByLead.set(leadKey, stages);
  });

  return [...stagesByLead.values()].reduce((counts, stages) => {
    stages.forEach((stage) => {
      counts[stage] = (counts[stage] || 0) + 1;
    });
    return counts;
  }, {});
}

function countBy(items, field) {
  return items.reduce((counts, item) => {
    const key = item[field] || "Blank";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function renderBreakdown(counts, order = []) {
  const orderedEntries = order.filter((label) => counts[label]).map((label) => [label, counts[label]]);
  const remainingEntries = Object.entries(counts)
    .filter(([label]) => !order.includes(label))
    .sort((a, b) => b[1] - a[1]);
  const entries = [...orderedEntries, ...remainingEntries];
  if (!entries.length) return `<div class="breakdown-row"><span>No data yet.</span></div>`;
  return entries.map(([label, count]) => `<div class="breakdown-row"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`).join("");
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

function renderAll() {
  renderTable();
  renderFollowups();
  renderDashboard();
}

async function saveField(leadId, field, value) {
  const lead = leads.find((item) => item.id === leadId);
  if (!lead) return;

  if (field === "stage") {
    await saveStageChange(lead, value);
    return;
  }

  await updateDoc(doc(leadsCollection, leadId), {
    [field]: value,
    updatedAt: serverTimestamp(),
  });
}

async function completeFollowUp(leadId, followupDate, nextFollowUpDate) {
  if (!followupDate) {
    window.alert("Choose when you followed up before updating the lead.");
    return;
  }

  if (!nextFollowUpDate) {
    window.alert("Choose the next follow-up date before updating the lead.");
    return;
  }

  await updateDoc(doc(leadsCollection, leadId), {
    lastTouch: followupDate,
    nextFollowUpDate,
    updatedAt: serverTimestamp(),
  });
}

async function deleteLead(leadId) {
  const lead = leads.find((item) => item.id === leadId);
  const leadName = lead?.name || "this lead";
  const confirmed = window.confirm(`Delete ${leadName}? This cannot be undone.`);
  if (!confirmed) return;

  await deleteDoc(doc(leadsCollection, leadId));
}

async function saveStageChange(lead, nextStage) {
  const history = Array.isArray(lead.stageHistory) ? [...lead.stageHistory] : [];
  const event = {
    stage: nextStage,
    date: todayISO(),
    createdAt: new Date().toISOString(),
  };

  if (nextStage === "Closed") {
    const amount = window.prompt("For how much?");
    event.amount = Number(String(amount || "0").replace(/[^0-9.]/g, "")) || 0;
  }

  history.push(event);

  await updateDoc(doc(leadsCollection, lead.id), {
    stage: nextStage,
    stageHistory: history,
    closedAmount: nextStage === "Closed" ? event.amount : lead.closedAmount || 0,
    updatedAt: serverTimestamp(),
  });
}

async function uploadLeadAttachment(leadId, file) {
  if (!(file instanceof File) || file.size === 0) return;

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${auth.currentUser.uid}/lead-attachments/${leadId}/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  const attachmentUrl = await getDownloadURL(fileRef);

  await updateDoc(doc(leadsCollection, leadId), {
    attachmentName: file.name,
    attachmentPath: path,
    attachmentUrl,
    updatedAt: serverTimestamp(),
  });
}

async function addLead(formData) {
  const stage = String(formData.get("stage") || "Not Contacted Yet");
  const event = {
    stage,
    date: todayISO(),
    createdAt: new Date().toISOString(),
  };

  if (stage === "Closed") {
    const amount = window.prompt("For how much?");
    event.amount = Number(String(amount || "0").replace(/[^0-9.]/g, "")) || 0;
  }

  const payload = tableFields.reduce((lead, field) => {
    lead[field] = String(formData.get(field) || "").trim();
    return lead;
  }, {});

  const leadRef = await addDoc(leadsCollection, {
    ...payload,
    stage,
    stageHistory: [event],
    closedAmount: event.amount || 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const file = formData.get("attachment");
  if (file instanceof File && file.size > 0) {
    await uploadLeadAttachment(leadRef.id, file);
  }
}

function setImportStatus(message, type = "") {
  importStatus.textContent = message;
  importStatus.dataset.status = type;
}

function normalizeImportText(value) {
  return String(value ?? "").trim();
}

function normalizeImportKey(value) {
  return normalizeImportText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeDropdownValue(value, options) {
  const text = normalizeImportText(value);
  if (!text) return "";
  const match = options.find((option) => option.toLowerCase() === text.toLowerCase());
  return match || text;
}

function excelSerialToISO(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 20000) return "";
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return date.toISOString().slice(0, 10);
}

function dateToISO(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = normalizeImportText(value);
  if (!text) return "";
  const serialDate = excelSerialToISO(text);
  if (serialDate) return serialDate;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function addDaysISO(baseISO, days) {
  const base = toDate(`${baseISO || todayISO()}T00:00:00`) || new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function relativeFollowUpToISO(value, baseISO) {
  const text = normalizeImportText(value).toLowerCase();
  if (!text) return "";
  if (text === "today") return baseISO || todayISO();
  if (text === "tomorrow") return addDaysISO(baseISO, 1);
  if (text === "3 days from now") return addDaysISO(baseISO, 3);
  if (text === "1 week") return addDaysISO(baseISO, 7);
  if (text === "1 month") return addDaysISO(baseISO, 30);
  return dateToISO(value);
}

function rowsToObjects(rows) {
  const [headers = [], ...dataRows] = rows;
  return dataRows.map((row) =>
    headers.reduce((record, header, index) => {
      if (header) record[header] = row[index] ?? "";
      return record;
    }, {}),
  );
}

async function readSheetObjects(file, sheetName, required = false) {
  try {
    const rows = await readXlsxFile(file, { sheet: sheetName });
    return rowsToObjects(rows);
  } catch (error) {
    if (required) throw error;
    return [];
  }
}

function getImportDuplicateKey(lead) {
  return [lead.name, lead.phone, lead.email].map(normalizeImportKey).join("|");
}

function buildNotesByLeadName(rows) {
  return rows.reduce((notes, row) => {
    const name = normalizeImportKey(row["Lead Name"]);
    const note = normalizeImportText(row["Notes:"]);
    if (name && note) notes.set(name, note);
    return notes;
  }, new Map());
}

function mapSpreadsheetLead(row, notesByLeadName) {
  const name = normalizeImportText(row["Lead Name"]);
  const lastTouch = dateToISO(row["Last Touch"]);
  const dueDate = dateToISO(row["Due Date Helper"]);
  const nextFollowUpDate = dueDate || relativeFollowUpToISO(row["Next Follow-Up Date"], lastTouch);
  const stage = normalizeDropdownValue(row.Stage, dropdowns.stages) || "Not Contacted Yet";
  const note = notesByLeadName.get(normalizeImportKey(name)) || "";

  return {
    name,
    phone: normalizeImportText(row.Phone),
    email: normalizeImportText(row.Email),
    source: normalizeDropdownValue(row.Source, dropdowns.sources),
    stage,
    owner: normalizeDropdownValue(row.Owner, dropdowns.owners) || "Unassigned",
    pain: normalizeDropdownValue(row.Pain, dropdowns.pains),
    spaceNeeded: normalizeDropdownValue(row["Space Needed"], dropdowns.spaces),
    deadline: dateToISO(row["Their Deadline"]),
    decisionMaker: normalizeDropdownValue(row["Decision Maker"], dropdowns.decisionMakers),
    budget: normalizeDropdownValue(row.Budget, dropdowns.budgets),
    city: normalizeDropdownValue(row.City, dropdowns.cities),
    lastTouch,
    nextFollowUpDate,
    lostReason: normalizeDropdownValue(row["(If They Said No) Why Did They Not Buy?"], dropdowns.lostReasons),
    notes: note,
    stageHistory: [
      {
        stage,
        date: lastTouch || todayISO(),
        createdAt: new Date().toISOString(),
        imported: true,
      },
    ],
    closedAmount: 0,
  };
}

async function importLeadSpreadsheet(file) {
  if (!leadsCollection) {
    throw new Error("Leads collection is not ready.");
  }

  setImportStatus("Importing spreadsheet...", "info");
  importLeadsButton.disabled = true;

  const rows = await readSheetObjects(file, "Leads", true);
  if (!rows.length) {
    throw new Error("No Leads sheet found.");
  }

  const followUpRows = await readSheetObjects(file, "Follow-Up Queue");
  const notesByLeadName = buildNotesByLeadName(followUpRows);
  const existingKeys = new Set(leads.map(getImportDuplicateKey));
  const importedAt = new Date().toISOString();
  let importedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const lead = mapSpreadsheetLead(row, notesByLeadName);
    const duplicateKey = getImportDuplicateKey(lead);
    if (!lead.name || existingKeys.has(duplicateKey)) {
      skippedCount += 1;
      continue;
    }

    await addDoc(leadsCollection, {
      ...lead,
      importedAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    existingKeys.add(duplicateKey);
    importedCount += 1;
  }

  setImportStatus(`Imported ${importedCount} leads${skippedCount ? `, skipped ${skippedCount}` : ""}.`, "success");
  importFileInput.value = "";
  importLeadsButton.disabled = false;
}

function setPasswordStatus(message, type = "") {
  passwordStatus.textContent = message;
  passwordStatus.dataset.status = type;
}

async function changePassword(formData) {
  const user = auth.currentUser;
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!user?.email) {
    setPasswordStatus("Please log in again before changing your password.", "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    setPasswordStatus("The new passwords do not match.", "error");
    return;
  }

  setPasswordStatus("Updating password...", "info");
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
  setPasswordStatus("Password updated successfully.", "success");
  passwordForm.reset();
}

function setView(nextView) {
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.classList.toggle("is-active", view.dataset.view === nextView);
  });
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewButton === nextView);
  });
  closeSidebar();
}

function openSidebar() {
  document.body.classList.add("is-sidebar-open");
}

function closeSidebar() {
  document.body.classList.remove("is-sidebar-open");
}

function toggleDesktopSidebar() {
  document.body.classList.toggle("is-sidebar-collapsed");
}

function handleMenuToggle() {
  if (window.matchMedia("(max-width: 920px)").matches) {
    document.body.classList.toggle("is-sidebar-open");
    return;
  }

  toggleDesktopSidebar();
}

function setLoadingMessage(text, showLogin = false) {
  if (loadingText) loadingText.textContent = text;
  if (loadingLogin) loadingLogin.hidden = !showLogin;
}

function redirectToLogin() {
  setLoadingMessage("Redirecting to login...", true);
  window.location.replace("/login");
}

let authReady = false;
let appBootstrapped = false;

function bootstrapApp(user) {
  if (appBootstrapped) return;
  appBootstrapped = true;

  fillDialogOptions();
  initEvents();
  setView("dashboard");
  userEmail.textContent = user.email || user.displayName || "Signed in";
  appShell.hidden = false;
  loadingScreen.hidden = true;
  initLeads(user);
}

function handleAuthUser(user) {
  authReady = true;

  if (!user) {
    redirectToLogin();
    return;
  }

  bootstrapApp(user);
}

function initEvents() {
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewButton));
  });

  menuToggles.forEach((button) => {
    button.addEventListener("click", handleMenuToggle);
  });
  sidebarClose.addEventListener("click", closeSidebar);
  sidebarOverlay.addEventListener("click", closeSidebar);

  settingsButton.addEventListener("click", () => {
    setPasswordStatus("");
    passwordForm.reset();
    passwordDialog.showModal();
  });

  document.querySelectorAll("[data-close-password-dialog]").forEach((button) => {
    button.addEventListener("click", () => passwordDialog.close());
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await changePassword(new FormData(passwordForm));
    } catch (error) {
      console.error(error);
      setPasswordStatus("We couldn't update the password. Check your current password and try again.", "error");
    }
  });

  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "/login";
  });

  addLeadButton.addEventListener("click", () => leadDialog.showModal());
  importLeadsButton.addEventListener("click", () => importFileInput.click());

  importFileInput.addEventListener("change", async () => {
    const [file] = importFileInput.files || [];
    if (!file) return;

    try {
      await importLeadSpreadsheet(file);
    } catch (error) {
      console.error(error);
      importLeadsButton.disabled = false;
      importFileInput.value = "";
      setImportStatus("Import failed. Make sure you selected the Lead-To-Booked spreadsheet.", "error");
    }
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => leadDialog.close());
  });

  leadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addLead(new FormData(leadForm));
    leadForm.reset();
    leadDialog.close();
  });

  leadRows.addEventListener("change", async (event) => {
    const attachmentInput = event.target.closest("[data-attachment-upload]");
    if (attachmentInput) {
      const row = attachmentInput.closest("[data-lead-id]");
      const [file] = attachmentInput.files || [];
      if (!row || !file) return;
      await uploadLeadAttachment(row.dataset.leadId, file);
      attachmentInput.value = "";
      return;
    }

    const field = event.target.dataset.field;
    const row = event.target.closest("[data-lead-id]");
    if (!field || !row) return;
    await saveField(row.dataset.leadId, field, event.target.value);
  });

  leadRows.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-lead]");
    if (!deleteButton) return;

    const row = deleteButton.closest("[data-lead-id]");
    if (!row) return;
    await deleteLead(row.dataset.leadId);
  });

  followupList.addEventListener("change", async (event) => {
    const followupConfirm = event.target.closest("[data-followup-confirm]");
    if (followupConfirm) {
      const card = followupConfirm.closest("[data-lead-id]");
      const details = card?.querySelector("[data-followup-details]");
      const nextStep = card?.querySelector("[data-next-followup-step]");
      if (details) details.hidden = !followupConfirm.checked;
      if (nextStep) nextStep.hidden = true;
      if (followupConfirm.checked) details?.querySelector("[data-followup-date]")?.focus();
      return;
    }

    const followupDateInput = event.target.closest("[data-followup-date]");
    if (followupDateInput) {
      const card = followupDateInput.closest("[data-lead-id]");
      const nextStep = card?.querySelector("[data-next-followup-step]");
      const nextInput = card?.querySelector("[data-next-followup-date]");
      if (nextStep) nextStep.hidden = !followupDateInput.value;
      if (followupDateInput.value && nextInput && !nextInput.value) {
        nextInput.value = addDaysISO(followupDateInput.value, 2);
      }
      if (followupDateInput.value) nextInput?.focus();
      return;
    }

    const field = event.target.dataset.field;
    const card = event.target.closest("[data-lead-id]");
    if (!field || !card) return;
    await saveField(card.dataset.leadId, field, event.target.value);
  });

  followupList.addEventListener("click", async (event) => {
    const completeButton = event.target.closest("[data-complete-followup]");
    if (!completeButton) return;

    const card = completeButton.closest("[data-lead-id]");
    const followupDate = card?.querySelector("[data-followup-date]")?.value;
    const nextFollowUpDate = card?.querySelector("[data-next-followup-date]")?.value;
    if (!card) return;
    completeButton.disabled = true;

    try {
      await completeFollowUp(card.dataset.leadId, followupDate, nextFollowUpDate);
    } finally {
      completeButton.disabled = false;
    }
  });

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.toLowerCase();
    renderTable();
  });

  leadSortSelect.addEventListener("change", () => {
    leadSortMode = leadSortSelect.value;
    renderTable();
  });

  dashboardRange.addEventListener("change", renderDashboard);
}

function initLeads(user) {
  leadsCollection = collection(db, "users", user.uid, "leads");
  unsubscribeLeads?.();
  unsubscribeLeads = onSnapshot(leadsCollection, (snapshot) => {
    leads = snapshot.docs.map(normalizeLead);
    renderAll();
  }, (error) => {
    console.error(error);
    leadRows.innerHTML = `<tr><td colspan="19">We could not load leads. Check Firestore rules and make sure Firestore is enabled.</td></tr>`;
    followupList.innerHTML = `<div class="queue-card"><div><h3>Follow-ups unavailable</h3><p>Firestore returned an error.</p></div></div>`;
    metricsNode.innerHTML = `<div class="metric-card"><span>Firestore Error</span><strong>Check Rules</strong></div>`;
  });
}

onAuthStateChanged(auth, handleAuthUser, (error) => {
  console.error(error);
  redirectToLogin();
});

window.setTimeout(() => {
  if (authReady || auth.currentUser) return;
  redirectToLogin();
}, 2000);
