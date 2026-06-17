import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signOut, updatePassword } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
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
const leadDialog = document.querySelector("[data-lead-dialog]");
const leadForm = document.querySelector("[data-lead-form]");
const passwordDialog = document.querySelector("[data-password-dialog]");
const passwordForm = document.querySelector("[data-password-form]");
const passwordStatus = document.querySelector("[data-password-status]");
const searchInput = document.querySelector("[data-search]");
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
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (!visibleLeads.length) {
    leadRows.innerHTML = `<tr><td colspan="18">No leads yet. Add your first lead to start tracking.</td></tr>`;
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
        </tr>
      `;
    })
    .join("");
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
  if (!lead.attachmentUrl) return `<span class="empty-state">No file</span>`;
  return `<a class="attachment-link" href="${escapeHtml(lead.attachmentUrl)}" target="_blank" rel="noreferrer">${escapeHtml(lead.attachmentName || "View file")}</a>`;
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
        <article class="queue-card">
          <div>
            <h3>${escapeHtml(lead.name || "Unnamed Lead")}</h3>
            <p>${escapeHtml(lead.notes || "No notes yet")}</p>
          </div>
          <span class="stage-pill">${escapeHtml(lead.stage || "")}</span>
          <span>${escapeHtml(lead.owner || "Unassigned")}</span>
          <span class="score-pill ${score.color}">${score.label}</span>
          <span class="date-pill ${isPastDue(lead) ? "overdue" : ""}">${formatDate(lead.nextFollowUpDate)}</span>
        </article>
      `;
    })
    .join("");
}

function renderDashboard() {
  const range = dashboardRange.value;
  const leadsInRange = leads.filter((lead) => eventDateInRange(lead.createdAt?.toDate?.() || lead.createdAt || todayISO(), range));
  const stageEvents = leads.flatMap((lead) =>
    (lead.stageHistory || []).map((event) => ({
      ...event,
      leadName: lead.name,
    })),
  );
  const eventsInRange = stageEvents.filter((event) => eventDateInRange(event.date, range));
  const closeEvents = leads.flatMap(getCountedCloseEvents).filter((event) => eventDateInRange(event.date, range));
  const closedRevenue = closeEvents.reduce((total, event) => total + Number(event.amount || 0), 0);
  const dueCount = leads.filter((lead) => isDue(lead) && (isPastDue(lead) || lead.nextFollowUpDate === todayISO())).length;
  const greenCount = leadsInRange.filter((lead) => scoreLead(lead).color === "green").length;
  const bookedCount = eventsInRange.filter((event) => event.stage === "Booked Consult").length;
  const showedCount = eventsInRange.filter((event) => event.stage === "Showed to Consult").length;

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
  stageBreakdownNode.innerHTML = renderBreakdown(countBy(leadsInRange, "stage"));
  sourceBreakdownNode.innerHTML = renderBreakdown(countBy(leadsInRange, "source"));
  stageEventsNode.innerHTML = eventsInRange.length
    ? eventsInRange
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 12)
        .map(
          (event) => `
            <div class="event-row">
              <span>${escapeHtml(event.leadName || "Lead")}: <strong>${escapeHtml(event.stage)}</strong></span>
              <span>${formatDate(event.date)}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="event-row"><span>No stage events in this range.</span></div>`;
}

function countBy(items, field) {
  return items.reduce((counts, item) => {
    const key = item[field] || "Blank";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function renderBreakdown(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
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
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${auth.currentUser.uid}/lead-attachments/${leadRef.id}/${Date.now()}-${safeName}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    const attachmentUrl = await getDownloadURL(fileRef);

    await updateDoc(leadRef, {
      attachmentName: file.name,
      attachmentPath: path,
      attachmentUrl,
      updatedAt: serverTimestamp(),
    });
  }
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
    window.location.href = "./login.html";
  });

  addLeadButton.addEventListener("click", () => leadDialog.showModal());

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
    const field = event.target.dataset.field;
    const row = event.target.closest("[data-lead-id]");
    if (!field || !row) return;
    await saveField(row.dataset.leadId, field, event.target.value);
  });

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.toLowerCase();
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
    leadRows.innerHTML = `<tr><td colspan="18">We could not load leads. Check Firestore rules and make sure Firestore is enabled.</td></tr>`;
    followupList.innerHTML = `<div class="queue-card"><div><h3>Follow-ups unavailable</h3><p>Firestore returned an error.</p></div></div>`;
    metricsNode.innerHTML = `<div class="metric-card"><span>Firestore Error</span><strong>Check Rules</strong></div>`;
  });
}

fillDialogOptions();
initEvents();
setView("dashboard");

onAuthStateChanged(auth, (user) => {
  if (!user) {
    setLoadingMessage("Redirecting to login...", true);
    window.location.href = "./login.html";
    return;
  }

  userEmail.textContent = user.email || user.displayName || "Signed in";
  appShell.hidden = false;
  loadingScreen.hidden = true;
  initLeads(user);
}, (error) => {
  console.error(error);
  setLoadingMessage("We couldn't load the CRM. Please log in again.", true);
});

window.setTimeout(() => {
  if (!loadingScreen.hidden) {
    setLoadingMessage("Still loading. If this stays here, log in again.", true);
  }
}, 5000);
