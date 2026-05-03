import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  doc,
  limit,
  query,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let editIndex = -1;
let recordsCache = [];
let lastPrescriptionForPrint = null;
let deferredInstallPrompt = null;

const pageTitles = {
  prescription: "New Prescription",
  records: "All Records",
  settings: "Settings",
  about: "About Us"
};

document.addEventListener("DOMContentLoaded", () => {
  setupPwa();
  initApp();
});

function initApp() {
  if (document.body.classList.contains("login-body")) {
    return;
  }

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    loadSettingsIntoForm();
    setTodayIfEmpty();
    setupNavigation();
    showView(location.hash.replace("#", "") || "prescription");
    fetchRecords();
  });
}

function setupPwa() {
  registerServiceWorker();
  setupInstallPrompt();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");

      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    } catch (error) {
      console.warn("Service worker registration failed:", error);
    }
  });
}

function setupInstallPrompt() {
  const installButton = document.getElementById("installAppBtn");
  if (!installButton) return;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.classList.add("show");
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;

    installButton.classList.remove("show");
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installButton.classList.remove("show");
  });
}

// ================= FETCH =================

async function fetchRecords() {
  const snapshot = await getDocs(collection(db, "records"));

  recordsCache = [];

  snapshot.forEach((docSnap) => {
    recordsCache.push({ id: docSnap.id, ...docSnap.data() });
  });

  displayData();
}

// ================= SAVE =================

async function saveData() {
  const data = collectFormData();

  if (editIndex === -1) {
    await addDoc(collection(db, "records"), data);
  } else {
    const id = recordsCache[editIndex].id;
    await updateDoc(doc(db, "records", id), data);
    editIndex = -1;
  }

  lastPrescriptionForPrint = data;
  await fetchRecords();
  clearForm();
  showView("records");
}

// ================= DELETE =================

async function deleteData(index) {
  if (!confirm("Delete?")) return;

  const id = recordsCache[index].id;

  await deleteDoc(doc(db, "records", id));

  fetchRecords();
}

// ================= DISPLAY =================

function displayData(list = recordsCache) {
  const table = document.getElementById("recordsTable");
  if (!table) return;

  table.innerHTML = "";

  list.forEach((record, index) => {
    const realIndex = recordsCache.indexOf(record);
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${record.name || "-"}</td>
      <td>${record.mobile || "-"}</td>
      <td>${formatDate(record.date)}</td>
      <td>Rs ${record.price || "0"}</td>
      <td>
        <button onclick="pdfRecord(${realIndex})">PDF</button>
        <button onclick="printRecord(${realIndex})">Print</button>
        <button onclick="editData(${realIndex})">Edit</button>
        <button onclick="deleteData(${realIndex})">Delete</button>
      </td>
    `;

    table.appendChild(row);
  });

  const count = document.getElementById("recordCount");
  if (count) count.textContent = `Showing ${list.length} records`;
}

// ================= EDIT =================

function editData(index) {
  const r = recordsCache[index];
  if (!r) return;

  setValue("name", r.name);
  setValue("mobile", r.mobile);
  setValue("address", r.address);
  setValue("date", r.date);
  setValue("price", r.price);
  setValue("note", r.note);

  setValue("od_sph", r.od?.sph);
  setValue("od_cyl", r.od?.cyl);
  setValue("od_axis", r.od?.axis);
  setValue("od_vision", r.od?.vision);
  setValue("od_add", r.od?.add);

  setValue("os_sph", r.os?.sph);
  setValue("os_cyl", r.os?.cyl);
  setValue("os_axis", r.os?.axis);
  setValue("os_vision", r.os?.vision);
  setValue("os_add", r.os?.add);

  editIndex = index;
  showView("prescription");
}

// ================= AUTH =================

async function loginOwner() {
  const identifier = valueOf("loginIdentifier");
  const password = valueOf("loginPassword");

  if (!identifier || !password) {
    alert("Email/mobile aur password dono enter karein.");
    return;
  }

  try {
    const email = await resolveOwnerEmail(identifier);
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "index.html";
  } catch (error) {
    alert(authErrorMessage(error));
  }
}

async function registerOwner() {
  const email = valueOf("registerEmail");
  const mobile = normalizeMobile(valueOf("registerMobile"));
  const password = valueOf("registerPassword");

  if (!email || !mobile || !password) {
    alert("Email, mobile number aur password tino enter karein.");
    return;
  }

  if (!/^\d{10}$/.test(mobile)) {
    alert("Mobile number 10 digit ka hona chahiye.");
    return;
  }

  if (password.length < 6) {
    alert("Password kam se kam 6 characters ka hona chahiye.");
    return;
  }

  try {
    const existingEmail = await findEmailByMobile(mobile);
    if (existingEmail) {
      alert("Is mobile number se account pehle se bana hua hai.");
      return;
    }

    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "owners", credential.user.uid), {
      email: credential.user.email,
      mobile,
      createdAt: new Date().toISOString()
    });

    window.location.href = "index.html";
  } catch (error) {
    alert(authErrorMessage(error));
  }
}

async function sendResetOtp() {
  const identifier = valueOf("resetIdentifier");

  if (!identifier) {
    alert("Registered email ya mobile number enter karein.");
    return;
  }

  try {
    const email = await resolveOwnerEmail(identifier);
    await sendPasswordResetEmail(auth, email);
    alert("Password reset link registered email par bhej diya gaya hai.");
  } catch (error) {
    alert(authErrorMessage(error));
  }
}

function resetPassword() {
  alert("Firebase reset link se password update karein.");
}

async function resolveOwnerEmail(identifier) {
  if (identifier.includes("@")) return identifier;

  const mobile = normalizeMobile(identifier);
  const email = await findEmailByMobile(mobile);

  if (!email) {
    throw new Error("mobile-not-found");
  }

  return email;
}

async function findEmailByMobile(mobile) {
  const ownersQuery = query(collection(db, "owners"), where("mobile", "==", mobile), limit(1));
  const snapshot = await getDocs(ownersQuery);

  if (snapshot.empty) return "";

  return snapshot.docs[0].data().email || "";
}

function normalizeMobile(value) {
  return value.replace(/\D/g, "").slice(-10);
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "Is email se account pehle se bana hua hai.",
    "auth/configuration-not-found": "Firebase Authentication setup incomplete hai. Firebase Console me Authentication enable karke Email/Password sign-in provider on karein.",
    "auth/invalid-credential": "Login detail galat hai. Email/mobile aur password check karein.",
    "auth/invalid-email": "Email address sahi format me enter karein.",
    "auth/missing-password": "Password enter karein.",
    "auth/network-request-failed": "Internet/Firebase connection issue hai. Thodi der baad try karein.",
    "auth/too-many-requests": "Bahut zyada attempts ho gaye. Thodi der baad try karein.",
    "auth/user-not-found": "Is email/mobile se account nahi mila.",
    "auth/weak-password": "Password kam se kam 6 characters ka hona chahiye.",
    "mobile-not-found": "Is mobile number se account nahi mila.",
    "permission-denied": "Firebase rules mobile lookup block kar rahe hain. Email se login karein ya owners collection ke rules update karein."
  };

  return messages[error.code || error.message] || `Error: ${error.message}`;
}

function showAuthPanel(panelId) {
  document.querySelectorAll("#loginPanel, #registerPanel, #forgotPanel").forEach((panel) => {
    panel.classList.toggle("auth-panel", panel.id !== panelId);
  });
}

async function logoutOwner() {
  await signOut(auth);
  window.location.href = "login.html";
}

// ================= BASIC =================

function collectFormData() {
  return {
    name: valueOf("name"),
    address: valueOf("address"),
    mobile: valueOf("mobile"),
    date: valueOf("date"),
    price: valueOf("price"),
    note: valueOf("note"),
    od: {
      sph: valueOf("od_sph"),
      cyl: valueOf("od_cyl"),
      axis: valueOf("od_axis"),
      vision: valueOf("od_vision"),
      add: valueOf("od_add")
    },
    os: {
      sph: valueOf("os_sph"),
      cyl: valueOf("os_cyl"),
      axis: valueOf("os_axis"),
      vision: valueOf("os_vision"),
      add: valueOf("os_add")
    }
  };
}

function clearForm() {
  document.querySelectorAll("#prescription input, #prescription textarea").forEach((el) => {
    el.value = "";
  });
  editIndex = -1;
  setTodayIfEmpty();
}

function searchData() {
  const query = valueOf("search").toLowerCase();
  const filtered = recordsCache.filter((record) => {
    return `${record.name || ""} ${record.mobile || ""}`.toLowerCase().includes(query);
  });

  displayData(filtered);
}

function setupNavigation() {
  document.querySelectorAll("[data-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showView(link.dataset.view);
      closeSidebar();
    });
  });
}

function showView(viewId) {
  if (!pageTitles[viewId]) viewId = "prescription";

  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === viewId);
  });

  document.querySelectorAll("[data-view]").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === viewId);
  });

  const title = document.getElementById("pageTitle");
  if (title) title.textContent = pageTitles[viewId];

  location.hash = viewId;
}

function saveSettings() {
  const settings = {
    shopName: valueOf("shopName"),
    shopMobile: valueOf("shopMobile"),
    shopAddress: valueOf("shopAddress")
  };

  localStorage.setItem("shopSettings", JSON.stringify(settings));
  alert("Settings saved.");
}

function loadSettingsIntoForm() {
  const settings = JSON.parse(localStorage.getItem("shopSettings") || "{}");
  setValue("shopName", settings.shopName);
  setValue("shopMobile", settings.shopMobile);
  setValue("shopAddress", settings.shopAddress);
  setValue("ownerLoginDisplay", auth.currentUser?.email || "");
}

function setTodayIfEmpty() {
  const date = document.getElementById("date");
  if (date && !date.value) date.value = new Date().toISOString().slice(0, 10);
}

function toggleSidebar() {
  document.body.classList.toggle("sidebar-open");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

document.addEventListener("click", (event) => {
  if (!document.body.classList.contains("sidebar-open")) return;

  const sidebar = document.querySelector(".sidebar");
  const toggle = document.querySelector(".sidebar-toggle");

  if (sidebar?.contains(event.target) || toggle?.contains(event.target)) return;

  closeSidebar();
});

function printCurrent() {
  const data = getCurrentPrintData();
  if (!data) return;

  const printArea = ensurePrintArea();
  printArea.innerHTML = buildPrescriptionPrintHtml(data);
  document.body.classList.add("printing-rx");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("printing-rx");
    printArea.innerHTML = "";
  }, 500);
}

function pdfCurrent() {
  if (!window.html2pdf) {
    alert("PDF library load nahi hui. Internet check karke page reload karein.");
    return;
  }

  const data = getCurrentPrintData();
  if (!data) return;

  downloadPrescriptionPdf(data);
}

function printRecord(index) {
  const record = recordsCache[index];
  if (!record) return;

  lastPrescriptionForPrint = normalizePrescriptionData(record);

  const printArea = ensurePrintArea();
  printArea.innerHTML = buildPrescriptionPrintHtml(lastPrescriptionForPrint);
  document.body.classList.add("printing-rx");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("printing-rx");
    printArea.innerHTML = "";
  }, 500);
}

function pdfRecord(index) {
  const record = recordsCache[index];
  if (!record) return;

  lastPrescriptionForPrint = normalizePrescriptionData(record);
  downloadPrescriptionPdf(lastPrescriptionForPrint);
}

function downloadPrescriptionPdf(data) {
  const printArea = ensurePrintArea();
  printArea.innerHTML = buildPrescriptionPrintHtml(data);

  window.html2pdf()
    .set({
      margin: 0,
      filename: "optical-record.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "px", format: [780, 780], orientation: "portrait" }
    })
    .from(printArea.firstElementChild)
    .save();
}

function getCurrentPrintData() {
  const activePanel = document.querySelector(".view-panel.active");

  if (activePanel?.id === "prescription") {
    return normalizePrescriptionData(collectFormData());
  }

  if (lastPrescriptionForPrint) {
    return normalizePrescriptionData(lastPrescriptionForPrint);
  }

  if (recordsCache.length) {
    return normalizePrescriptionData(recordsCache[0]);
  }

  alert("PDF banane ke liye pehle prescription save karein ya form fill karein.");
  return null;
}

function ensurePrintArea() {
  let printArea = document.getElementById("rxPrintArea");

  if (!printArea) {
    printArea = document.createElement("div");
    printArea.id = "rxPrintArea";
    document.body.appendChild(printArea);
  }

  return printArea;
}

function buildPrescriptionPrintHtml(prescriptionData) {
  const data = normalizePrescriptionData(prescriptionData);
  const settings = JSON.parse(localStorage.getItem("shopSettings") || "{}");
  const invoiceNumber = String(editIndex >= 0 ? editIndex + 1 : recordsCache.length + 1).padStart(4, "0");

  return `
    <section class="rx-print">
      <header class="rx-print-header">
        <div class="rx-shop">
          <div class="rx-logo"><img src="logo.png" alt=""></div>
          <div>
            <h2>${escapeHtml(settings.shopName || "Brand Optical")}</h2>
            <p>Clear Vision, Better Life</p>
          </div>
        </div>
        <div class="rx-contact">
          <p><span class="rx-contact-icon">&#9742;</span>${escapeHtml(settings.shopMobile || "9315987700")}</p>
          <p><span class="rx-contact-icon">&#9679;</span>${escapeHtml(settings.shopAddress || "Shaheen Bhag , New Delhi")}</p>
        </div>
      </header>

      <div class="rx-title">
        <h1>SPECTACLE PRESCRIPTION</h1>
        <div class="divider">
          <span class="line"></span>
          <span class="rx-glasses" aria-hidden="true"></span>
          <span class="line"></span>
        </div>
      </div>

      <div class="rx-info-row">
        <div class="rx-details">
          ${detailRow("Name", data.name)}
          ${detailRow("Mobile", data.mobile)}
          ${detailRow("Address", data.address)}
          ${detailRow("Date", formatDate(data.date))}
        </div>
        <div>
          <p class="rx-invoice"><strong>Invoice No :</strong> ${invoiceNumber}</p>
          <div class="rx-price">
            <strong>TOTAL PRICE</strong>
            <span>&#8377; ${escapeHtml(data.price || "0")}</span>
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>EYE</th>
            <th>SPH</th>
            <th>CYL</th>
            <th>AXIS</th>
            <th>VISION</th>
            <th>ADD</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>O.D (Right)</td>
            <td>${escapeHtml(data.od.sph || "-")}</td>
            <td>${escapeHtml(data.od.cyl || "-")}</td>
            <td>${escapeHtml(data.od.axis || "-")}</td>
            <td>${escapeHtml(data.od.vision || "-")}</td>
            <td>${escapeHtml(data.od.add || "-")}</td>
          </tr>
          <tr>
            <td>O.S (Left)</td>
            <td>${escapeHtml(data.os.sph || "-")}</td>
            <td>${escapeHtml(data.os.cyl || "-")}</td>
            <td>${escapeHtml(data.os.axis || "-")}</td>
            <td>${escapeHtml(data.os.vision || "-")}</td>
            <td>${escapeHtml(data.os.add || "-")}</td>
          </tr>
        </tbody>
      </table>

      <div class="rx-note"><strong>Note:</strong> ${escapeHtml(data.note)}</div>
      <div class="rx-thanks"><span>Thank you for visiting us!</span></div>
      <footer class="rx-footer">Better Vision Today, Brighter Tomorrow.</footer>
    </section>
  `;
}

function detailRow(label, value) {
  return `
    <div class="rx-detail">
      <strong>${label}</strong>
      <span>:</span>
      <span>${escapeHtml(value || "-")}</span>
    </div>
  `;
}

function normalizePrescriptionData(data = {}) {
  return {
    name: data.name || "",
    address: data.address || "",
    mobile: data.mobile || "",
    date: data.date || "",
    price: data.price || "",
    note: data.note || "",
    od: {
      sph: data.od?.sph || "",
      cyl: data.od?.cyl || "",
      axis: data.od?.axis || "",
      vision: data.od?.vision || "",
      add: data.od?.add || ""
    },
    os: {
      sph: data.os?.sph || "",
      cyl: data.os?.cyl || "",
      axis: data.os?.axis || "",
      vision: data.os?.vision || "",
      add: data.os?.add || ""
    }
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function valueOf(id) {
  return document.getElementById(id)?.value || "";
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || "";
}

function formatDate(d) {
  if (!d) return "-";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

window.saveData = saveData;
window.deleteData = deleteData;
window.editData = editData;
window.clearForm = clearForm;
window.searchData = searchData;
window.loginOwner = loginOwner;
window.registerOwner = registerOwner;
window.sendResetOtp = sendResetOtp;
window.resetPassword = resetPassword;
window.showAuthPanel = showAuthPanel;
window.logoutOwner = logoutOwner;
window.saveSettings = saveSettings;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.printCurrent = printCurrent;
window.pdfCurrent = pdfCurrent;
window.printRecord = printRecord;
window.pdfRecord = pdfRecord;
