const SUPABASE_URL = "PEGA_AQUI_TU_PROJECT_URL";
const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_ANON_PUBLIC_KEY";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const elEmail = document.getElementById("email");
const elPass = document.getElementById("pass");
const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const authState = document.getElementById("authState");

const elQ = document.getElementById("q");
const tbody = document.getElementById("tbody");
const stats = document.getElementById("stats");
const dlg = document.getElementById("dlg");
const dlgTitle = document.getElementById("dlgTitle");
const msg = document.getElementById("msg");
const elCedula = document.getElementById("cedula");
const elNombre = document.getElementById("nombre");

let editingId = null;
let cache = [];

function norm(s){ return (s ?? "").toString().trim().toUpperCase(); }
function escapeHtml(str){
  return (str ?? "").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

async function refreshAuthUI(){
  const { data } = await supabase.auth.getSession();
  authState.textContent = data.session ? "✅ Sesión activa" : "❌ Sin sesión";

  const locked = !data.session;
  document.getElementById("btnAdd").disabled = locked;
  document.getElementById("btnExport").disabled = locked;
  document.getElementById("file").disabled = locked;
  elQ.disabled = locked;

  if (data.session) await loadClientes();
  else { cache = []; render(); }
}

btnLogin.onclick = async () => {
  const email = elEmail.value.trim();
  const password = elPass.value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) alert(error.message);
  await refreshAuthUI();
};

btnLogout.onclick = async () => {
  await supabase.auth.signOut();
  await refreshAuthUI();
};

async function loadClientes(){
  const { data, error } = await supabase
    .from("clientes")
    .select("id, cedula, nombre_completo")
    .order("nombre_completo", { ascending: true });

  if (error) { alert(error.message); return; }
  cache = data ?? [];
  render();
}

function render(){
  const q = norm(elQ.value);
  const filtered = cache.filter(c => norm(c.cedula + " " + c.nombre_completo).includes(q));

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td>${escapeHtml(c.cedula)}</td>
      <td>${escapeHtml(c.nombre_completo)}</td>
      <td>
        <button data-edit="${c.id}">Editar</button>
        <button data-del="${c.id}">Borrar</button>
      </td>
    </tr>
  `).join("");

  stats.textContent = `Mostrando ${filtered.length} de ${cache.length} clientes`;
}

function openNew(){
  editingId = null;
  dlgTitle.textContent = "Nuevo cliente";
  msg.textContent = "";
  elCedula.value = "";
  elNombre.value = "";
  dlg.showModal();
  elCedula.focus();
}

function openEdit(id){
  const c = cache.find(x => x.id === id);
  if (!c) return;
  editingId = id;
  dlgTitle.textContent = "Editar cliente";
  msg.textContent = "";
  elCedula.value = c.cedula;
  elNombre.value = c.nombre_completo;
  dlg.showModal();
  elCedula.focus();
}

function validate(cedula, nombre){
  const c = cedula.trim();
  const n = nombre.trim();
  if (!c || !n) return "Cédula y Nombre son obligatorios.";
  if (!/^\d{10}$/.test(c)) return "La cédula debe tener 10 dígitos (solo números).";
  return null;
}

async function upsert(){
  const cedula = elCedula.value;
  const nombre = elNombre.value;
  const err = validate(cedula, nombre);
  if (err) { msg.textContent = err; return; }

  if (editingId){
    const { error } = await supabase
      .from("clientes")
      .update({ cedula: cedula.trim(), nombre_completo: nombre.trim() })
      .eq("id", editingId);
    if (error) { msg.textContent = error.message; return; }
  } else {
    const { error } = await supabase
      .from("clientes")
      .insert({ cedula: cedula.trim(), nombre_completo: nombre.trim() });
    if (error) { msg.textContent = error.message; return; }
  }

  dlg.close();
  await loadClientes();
}

async function delCliente(id){
  const c = cache.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`¿Borrar a: ${c.nombre_completo} (${c.cedula})?`)) return;

  const { error } = await supabase.from("clientes").delete().eq("id", id);
  if (error) { alert(error.message); return; }
  await loadClientes();
}

document.getElementById("btnAdd").onclick = openNew;
document.getElementById("btnSave").onclick = upsert;
document.getElementById("btnCancel").onclick = () => dlg.close();
elQ.oninput = render;

tbody.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.edit) openEdit(b.dataset.edit);
  if (b.dataset.del) delCliente(b.dataset.del);
});

document.getElementById("btnExport").onclick = () => {
  const header = "CEDULA,NOMBRE_COMPLETO\n";
  const rows = cache.map(c => `${csv(c.cedula)},${csv(c.nombre_completo)}`).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "clientes_export.csv";
  a.click();
  URL.revokeObjectURL(a.href);
};

function csv(v){
  const s = (v ?? "").toString();
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}

document.getElementById("file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  const text = await f.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return;

  const toUpsert = [];
  for (let i=1; i<lines.length; i++){
    const [cedula, nombre] = parseCSVLine(lines[i]);
    if (!cedula || !nombre) continue;
    if (!/^\d{10}$/.test(cedula.trim())) continue;
    toUpsert.push({ cedula: cedula.trim(), nombre_completo: nombre.trim() });
  }

  const { error } = await supabase
    .from("clientes")
    .upsert(toUpsert, { onConflict: "cedula" });

  if (error) alert(error.message);
  await loadClientes();
  e.target.value = "";
});

function parseCSVLine(line){
  const out = [];
  let cur = "", inQ = false;
  for (let i=0; i<line.length; i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQ && line[i+1] === '"'){ cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ){
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

refreshAuthUI();
