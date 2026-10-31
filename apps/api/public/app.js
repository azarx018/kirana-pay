const $ = (id) => document.getElementById(id);
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); }, 4200);
}

const rupiah = (n) => "Rp" + new Intl.NumberFormat("id-ID").format(n);
const fmtDate = (iso) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const state = { me: null, providers: [], qris: [], jobs: [], keys: [], file: null, keyPlain: null };

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  const type = res.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    const err = body?.error || { code: String(res.status), message: res.statusText };
    const e = new Error(err.message);
    e.code = err.code;
    e.status = res.status;
    throw e;
  }
  return body?.data ?? body;
}

const showError = (id, msg) => { const el = $(id); el.textContent = msg; el.hidden = false; };
const hideError = (id) => { $(id).hidden = true; };

/* ---------------- auth ---------------- */
document.querySelectorAll(".auth-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((b) => b.classList.toggle("active", b === btn));
    $("loginForm").hidden = btn.dataset.auth !== "login";
    $("registerForm").hidden = btn.dataset.auth !== "register";
    hideError("authError");
  });
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError("authError");
  $("loginBtn").disabled = true;
  try {
    await api("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: $("loginEmail").value, password: $("loginPassword").value }),
    });
    await boot();
  } catch (err) {
    showError("authError", err.message);
  } finally {
    $("loginBtn").disabled = false;
  }
});

$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError("authError");
  $("registerBtn").disabled = true;
  try {
    await api("/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: $("regEmail").value,
        password: $("regPassword").value,
        merchantName: $("regMerchant").value,
      }),
    });
    await boot();
  } catch (err) {
    showError("authError", err.message);
  } finally {
    $("registerBtn").disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  try { await api("/v1/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  state.me = null;
  $("appView").hidden = true;
  $("topbarAuth").hidden = true;
  $("navLinks").hidden = true;
  hideKeyOnce();
  $("authView").hidden = false;
  $("brandSub").textContent = "Payments, Made Effortless.";
});

/* ---------------- tabs ---------------- */
document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b === btn));
    for (const name of ["generator", "qris", "settings"]) {
      $(`tab-${name}`).hidden = name !== btn.dataset.tab;
    }
    hideKeyOnce();
    history.replaceState(null, "", `#${btn.dataset.tab}`);
  });
});

/* ---------------- generator ---------------- */
const amountInput = $("genAmount");
amountInput.addEventListener("input", () => {
  const digits = amountInput.value.replace(/\D/g, "");
  amountInput.value = digits ? new Intl.NumberFormat("id-ID").format(Number(digits)) : "";
});
$("genChips").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-amount]");
  if (!btn) return;
  amountInput.value = new Intl.NumberFormat("id-ID").format(Number(btn.dataset.amount));
});

$("genForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError("genError");
  const amount = Number(amountInput.value.replace(/\D/g, ""));
  const qrisId = $("genQris").value;
  if (!qrisId) return showError("genError", "Pilih QRIS dulu (tambahkan di tab QRIS Saya).");
  if (!amount) return showError("genError", "Nominal harus lebih dari 0.");

  const body = new FormData();
  body.append("qrisId", qrisId);
  body.append("amount", String(amount));
  const note = $("genNote").value.trim();
  if (note) body.append("note", note);

  $("genSubmit").disabled = true;
  $("genSubmit").textContent = "Memproses…";
  try {
    const d = await api("/v1/qr/convert", { method: "POST", body });
    renderResult(d);
    loadJobs();
  } catch (err) {
    showError("genError", `${err.code}: ${err.message}`);
  } finally {
    $("genSubmit").disabled = false;
    $("genSubmit").textContent = "Generate QR";
  }
});

function renderResult(d) {
  $("genEmpty").hidden = true;
  $("genResult").hidden = false;
  $("genStatus").textContent = d.status;
  $("genQrImg").src = `data:image/png;base64,${d.qrImage.data}`;
  $("genResultAmount").textContent = rupiah(d.amount);
  $("genResultMerchant").textContent = d.merchant.name;
  $("genResultNmid").textContent = d.merchant.nmid;
  $("genResultId").textContent = d.id;
  const link = $("genDownload");
  link.href = `data:image/png;base64,${d.qrImage.data}`;
  link.download = `qris-${d.amount}-${d.id.slice(0, 8)}.png`;
}

$("genAgain").addEventListener("click", () => {
  $("genResult").hidden = true;
  $("genEmpty").hidden = false;
  $("genStatus").textContent = "belum ada";
});

/* ---------------- qris ---------------- */
const qrisDz = $("qrisDropzone");
const qrisFile = $("qrisFile");
qrisDz.addEventListener("click", (e) => { if (e.target.id !== "qrisClearFile") qrisFile.click(); });
qrisDz.addEventListener("dragover", (e) => { e.preventDefault(); qrisDz.classList.add("drag"); });
qrisDz.addEventListener("dragleave", () => qrisDz.classList.remove("drag"));
qrisDz.addEventListener("drop", (e) => {
  e.preventDefault();
  qrisDz.classList.remove("drag");
  if (e.dataTransfer.files?.[0]) setQrisFile(e.dataTransfer.files[0]);
});
qrisFile.addEventListener("change", () => { if (qrisFile.files?.[0]) setQrisFile(qrisFile.files[0]); });
$("qrisClearFile").addEventListener("click", (e) => { e.stopPropagation(); qrisFile.click(); });

function setQrisFile(f) {
  if (!/^image\/(png|jpe?g)$/.test(f.type)) return showError("qrisError", "File harus PNG atau JPEG.");
  state.file = f;
  $("qrisPreview").src = URL.createObjectURL(f);
  $("qrisFileName").textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
  $("qrisDropEmpty").hidden = true;
  $("qrisDropPreview").hidden = false;
  hideError("qrisError");
}

$("qrisForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError("qrisError");
  if (!state.file) return showError("qrisError", "Pilih gambar QRIS dulu.");
  if (!$("qrisProvider").value) return showError("qrisError", "Pilih payment provider.");

  const body = new FormData();
  body.append("file", state.file);
  body.append("providerCode", $("qrisProvider").value);
  body.append("displayName", $("qrisName").value.trim());

  $("qrisSubmit").disabled = true;
  $("qrisSubmit").textContent = "Menyimpan…";
  try {
    await api("/v1/qris", { method: "POST", body });
    state.file = null;
    $("qrisForm").reset();
    $("qrisDropEmpty").hidden = false;
    $("qrisDropPreview").hidden = true;
    await loadQris();
  } catch (err) {
    showError("qrisError", `${err.code}: ${err.message}`);
  } finally {
    $("qrisSubmit").disabled = false;
    $("qrisSubmit").textContent = "Simpan QRIS";
  }
});

async function loadQris() {
  state.qris = await api("/v1/qris");
  const active = state.qris.filter((q) => q.status === "ACTIVE");
  $("qrisCount").textContent = `${active.length} aktif / ${state.qris.length} total`;

  const select = $("genQris");
  select.innerHTML = "";
  if (!active.length) {
    select.innerHTML = '<option value="">— belum ada QRIS aktif —</option>';
  } else {
    for (const q of active) {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.textContent = `${q.displayName} · ${q.provider.name}`;
      select.appendChild(opt);
    }
  }

  const list = $("qrisList");
  list.innerHTML = "";
  $("qrisEmpty").hidden = state.qris.length > 0;
  list.hidden = state.qris.length === 0;

  for (const q of state.qris) {
    const li = document.createElement("li");
    li.className = "qris-item";
    li.innerHTML = `
      <img class="qris-thumb" src="${q.imageUrl}" alt="" loading="lazy" />
      <div class="h-left">
        <span class="h-merchant">${escapeHtml(q.displayName)}
          <span class="pill ${q.status === "ARCHIVED" ? "pill-muted" : ""}">${q.status}</span></span>
        <span class="h-meta">${escapeHtml(q.provider.name)} · ${escapeHtml(q.nmid || "-")}</span>
      </div>
      <div class="qris-actions">
        <button class="link" data-replace="${q.id}" type="button">Ganti</button>
        ${q.status === "ACTIVE" ? `<button class="link danger" data-archive="${q.id}" type="button">Arsip</button>` : ""}
      </div>`;
    list.appendChild(li);
  }

  list.querySelectorAll("[data-archive]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Arsipkan QRIS ini?")) return;
      await api(`/v1/qris/${btn.dataset.archive}`, { method: "DELETE" });
      await loadQris();
    }),
  );

  list.querySelectorAll("[data-replace]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg";
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        const body = new FormData();
        body.append("file", f);
        try {
          await api(`/v1/qris/${btn.dataset.replace}/image`, { method: "PUT", body });
          await loadQris();
        } catch (err) {
          toast(`${err.code}: ${err.message}`);
        }
      };
      input.click();
    }),
  );
}

/* ---------------- jobs ---------------- */
async function loadJobs() {
  state.jobs = await api("/v1/qr?limit=10");
  const list = $("jobs");
  list.innerHTML = "";
  $("jobsEmpty").hidden = state.jobs.length > 0;
  list.hidden = state.jobs.length === 0;
  for (const j of state.jobs) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="h-left">
        <span class="h-merchant">${escapeHtml(j.merchant.name)}<span class="pill">${escapeHtml(j.status)}</span></span>
        <span class="h-meta">${fmtDate(j.createdAt)} · ${escapeHtml(j.merchant.nmid)}</span>
      </div>
      <span class="h-amount">${rupiah(j.amount)}</span>`;
    list.appendChild(li);
  }
}
$("refreshJobs").addEventListener("click", loadJobs);

/* ---------------- settings ---------------- */
$("merchantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("merchantMsg").hidden = true;
  try {
    const m = await api("/v1/merchant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: $("merchantName").value.trim(), phone: $("merchantPhone").value.trim() }),
    });
    $("merchantName").value = m.name;
    $("merchantBadge").textContent = m.name;
    $("merchantMsg").hidden = false;
  } catch (err) {
    toast(`${err.code}: ${err.message}`);
  }
});

async function loadKeys() {
  state.keys = await api("/v1/api-keys");
  const list = $("keysList");
  list.innerHTML = "";
  $("keysEmpty").hidden = state.keys.length > 0;
  list.hidden = state.keys.length === 0;
  for (const k of state.keys) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="h-left">
        <span class="h-merchant">${escapeHtml(k.name)} <span class="pill ${k.revoked ? "pill-muted" : ""}">${k.revoked ? "REVOKED" : "ACTIVE"}</span></span>
        <span class="h-meta mono">${escapeHtml(k.prefix)}… · dibuat ${fmtDate(k.createdAt)} · ${k.lastUsedAt ? "dipakai " + fmtDate(k.lastUsedAt) : "belum dipakai"}</span>
      </div>
      ${k.revoked ? "" : `<button class="link danger" data-revoke="${k.id}" type="button">Revoke</button>`}`;
    list.appendChild(li);
  }
  list.querySelectorAll("[data-revoke]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Revoke API key ini? Aplikasi yang memakainya akan langsung gagal.")) return;
      await api(`/v1/api-keys/${btn.dataset.revoke}`, { method: "DELETE" });
      await loadKeys();
    }),
  );
}

$("newKey").addEventListener("click", async () => {
  const name = ($("keyName").value || "API key").trim();
  try {
    const data = await api("/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    $("keyName").value = "";
    state.keyPlain = data.key;
    $("keyOnceValue").textContent = data.key;
    $("copyHint").textContent = "";
    $("keyOnce").hidden = false;
    $("keyOnce").scrollIntoView({ block: "nearest", behavior: "smooth" });
    await loadKeys();
  } catch (err) {
    toast(`${err.code}: ${err.message}`);
  }
});

/* ---------------- one-time key reveal ---------------- */
function hideKeyOnce() {
  state.keyPlain = null;
  $("keyOnceValue").textContent = "";
  $("keyOnce").hidden = true;
  $("copyHint").textContent = "";
}

$("dismissKey").addEventListener("click", hideKeyOnce);

let copyTimer = null;
function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}

$("copyKey").addEventListener("click", async () => {
  if (!state.keyPlain) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(state.keyPlain);
    ok = true;
  } catch {
    ok = legacyCopy(state.keyPlain);
  }
  $("copyHint").textContent = ok
    ? "Tersalin. Tempel di server kamu, lalu sembunyikan."
    : "Gagal menyalin — blok key lalu Ctrl/Cmd+C.";
  clearTimeout(copyTimer);
  copyTimer = setTimeout(hideKeyOnce, 60000);
});

window.addEventListener("beforeunload", hideKeyOnce);

/* ---------------- boot ---------------- */
async function boot() {
  try {
    state.me = await api("/v1/auth/me");
  } catch {
    $("authView").hidden = false;
    $("appView").hidden = true;
    $("topbarAuth").hidden = true;
    return;
  }
  $("authView").hidden = true;
  $("appView").hidden = false;
  $("topbarAuth").hidden = false;
  $("navLinks").hidden = false;
  $("merchantBadge").textContent = state.me.merchant.name;
  $("merchantName").value = state.me.merchant.name;
  $("merchantEmail").value = state.me.user.email;
  $("settingsRole").textContent = state.me.merchant.role;

  state.providers = await api("/v1/payment-providers");
  const psel = $("qrisProvider");
  psel.innerHTML = '<option value="">— pilih provider —</option>';
  for (const p of state.providers) {
    const o = document.createElement("option");
    o.value = p.code;
    o.textContent = p.name;
    psel.appendChild(o);
  }

  await Promise.all([loadQris(), loadJobs(), loadKeys()]);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

boot();
