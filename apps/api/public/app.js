const $ = (id) => document.getElementById(id);

const state = { file: null, busy: false };

const rupiah = (n) => "Rp" + new Intl.NumberFormat("id-ID").format(n);
const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/* ---------- API key ---------- */
const KEY_STORE = "kirana.apiKey";
$("apiKey").value = localStorage.getItem(KEY_STORE) || "";
$("saveKey").addEventListener("click", () => {
  localStorage.setItem(KEY_STORE, $("apiKey").value.trim());
  $("saveKey").textContent = "Tersimpan";
  setTimeout(() => ($("saveKey").textContent = "Simpan"), 1200);
  loadHistory();
});

/* ---------- file picker ---------- */
const dz = $("dropzone");
const fileInput = $("file");

dz.addEventListener("click", (e) => {
  if (e.target.id === "clearFile") return;
  fileInput.click();
});
dz.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
dz.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("drag");
});
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("drag");
  const f = e.dataTransfer.files?.[0];
  if (f) setFile(f);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) setFile(fileInput.files[0]);
});
$("clearFile").addEventListener("click", (e) => {
  e.stopPropagation();
  resetFile();
  fileInput.click();
});

function setFile(f) {
  if (!/^image\/(png|jpe?g)$/.test(f.type)) {
    showError("Format file harus PNG atau JPEG.");
    return;
  }
  if (f.size > 5 * 1024 * 1024) {
    showError("Ukuran file maksimal 5 MB.");
    return;
  }
  state.file = f;
  $("preview").src = URL.createObjectURL(f);
  $("fileName").textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
  $("dropEmpty").hidden = true;
  $("dropPreview").hidden = false;
  hideError();
}

function resetFile() {
  state.file = null;
  fileInput.value = "";
  $("dropEmpty").hidden = false;
  $("dropPreview").hidden = true;
}

/* ---------- amount ---------- */
const amountInput = $("amount");
amountInput.addEventListener("input", () => {
  const digits = amountInput.value.replace(/\D/g, "");
  amountInput.value = digits ? new Intl.NumberFormat("id-ID").format(Number(digits)) : "";
});
$("chips").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-amount]");
  if (!btn) return;
  amountInput.value = new Intl.NumberFormat("id-ID").format(Number(btn.dataset.amount));
  amountInput.focus();
});

/* ---------- submit ---------- */
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;

  const amount = Number(amountInput.value.replace(/\D/g, ""));
  if (!state.file) return showError("Pilih gambar QRIS dulu.");
  if (!amount || amount < 1) return showError("Nominal harus lebih dari 0.");

  const key = $("apiKey").value.trim();
  if (!key) return showError("Isi API key dulu (ada di ~/kirana-pay/.env).");

  const body = new FormData();
  body.append("file", state.file);
  body.append("amount", String(amount));
  const note = $("note").value.trim();
  if (note) body.append("note", note);

  setBusy(true);
  hideError();
  try {
    const res = await fetch("/v1/qr/convert", { method: "POST", headers: { "x-api-key": key }, body });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(`${json?.error?.code || res.status}: ${json?.error?.message || "gagal"}`);
    }
    renderResult(json.data);
    loadHistory();
  } catch (err) {
    showError(err.message || "Gagal membuat QR.");
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  state.busy = busy;
  const btn = $("submit");
  btn.disabled = busy;
  btn.textContent = busy ? "Memproses…" : "Generate QR";
}

function renderResult(d) {
  $("empty").hidden = true;
  $("result").hidden = false;
  $("resultStatus").textContent = d.status;
  $("qrImg").src = `data:image/png;base64,${d.qrImage.data}`;
  $("resultAmount").textContent = rupiah(d.amount);
  $("resultMerchant").textContent = d.merchant.name;
  $("resultNmid").textContent = d.merchant.nmid;
  $("resultId").textContent = d.id;

  const link = $("download");
  link.href = `data:image/png;base64,${d.qrImage.data}`;
  link.download = `qris-${d.amount}-${d.id.slice(0, 8)}.png`;
}

$("again").addEventListener("click", () => {
  $("result").hidden = true;
  $("empty").hidden = false;
  $("resultStatus").textContent = "belum ada";
  amountInput.focus();
});

/* ---------- errors ---------- */
function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = false;
}
function hideError() {
  $("error").hidden = true;
}

/* ---------- history ---------- */
$("refresh").addEventListener("click", loadHistory);

async function loadHistory() {
  const key = $("apiKey").value.trim();
  if (!key) return;
  try {
    const res = await fetch("/v1/qr?limit=10", { headers: { "x-api-key": key } });
    if (!res.ok) return;
    const json = await res.json();
    renderHistory(json.data || []);
  } catch {
    /* history is best-effort */
  }
}

function renderHistory(items) {
  const list = $("history");
  const empty = $("historyEmpty");
  list.innerHTML = "";
  if (!items.length) {
    empty.hidden = false;
    list.hidden = true;
    return;
  }
  empty.hidden = true;
  list.hidden = false;
  for (const it of items) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="h-left">
        <span class="h-merchant">${escapeHtml(it.merchant?.name || "-")}<span class="pill">${escapeHtml(it.status)}</span></span>
        <span class="h-meta">${fmtDate(it.createdAt)} · ${escapeHtml(it.merchant?.nmid || "")}</span>
      </div>
      <span class="h-amount">${rupiah(it.amount)}</span>`;
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadHistory();
