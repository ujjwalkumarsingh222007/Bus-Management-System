const API = "";
let token = localStorage.getItem("sr_token") || "";
let currentUser = JSON.parse(localStorage.getItem("sr_user") || "null");
let authMode = "login";
let page = "dashboard";
let cachedRoutes = [], cachedBuses = [], cachedStudents = [], cachedDrivers = [];

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
async function api(url, options = {}) {
  const response = await fetch(API + url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}
function toast(message) {
  $("toast").textContent = message; $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}
function showAuthMessage(message) { $("authMessage").textContent = message; }
function setAuthMode(mode) {
  authMode = mode;
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
  ["nameField","roleField","contactField","addressField"].forEach(id => $(id).classList.toggle("hidden", mode === "login"));
  $("authTitle").textContent = mode === "login" ? "Welcome back" : "Create your account";
  $("authSubmit").textContent = mode === "login" ? "Login" : "Register";
  showAuthMessage("");
}
$("loginTab").onclick = () => setAuthMode("login");
$("registerTab").onclick = () => setAuthMode("register");
$("authForm").onsubmit = async e => {
  e.preventDefault(); showAuthMessage("");
  const body = { email: $("email").value.trim(), password: $("password").value };
  if (authMode === "register") Object.assign(body, { name: $("name").value.trim(), role: $("role").value, contact: $("contact").value.trim(), address: $("address").value.trim() });
  try {
    if (authMode === "register") {
      await api("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
      setAuthMode("login"); showAuthMessage("Registration successful. Please log in with your new account.");
    } else {
      const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
      token = result.token; currentUser = result.user;
      localStorage.setItem("sr_token", token); localStorage.setItem("sr_user", JSON.stringify(currentUser));
      boot();
    }
  } catch (err) { showAuthMessage(err.message); }
};
$("logoutBtn").onclick = logout;
function logout() {
  token = ""; currentUser = null; localStorage.removeItem("sr_token"); localStorage.removeItem("sr_user");
  $("appView").classList.add("hidden"); $("authView").classList.remove("hidden");
}
function boot() {
  if (!token || !currentUser) return;
  $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
  $("userName").textContent = currentUser.name; $("userRole").textContent = currentUser.role;
  $("avatar").textContent = $("topAvatar").textContent = currentUser.name[0].toUpperCase();
  const items = currentUser.role === "admin"
    ? [["dashboard","▦","Dashboard"],["buses","▣","Bus management"],["routes","⌁","Route management"],["allocation","♙","Student allocation"],["reports","▤","Reports"]]
    : currentUser.role === "driver"
    ? [["dashboard","▦","My trip"],["driver","⌁","Trip controls"]]
    : [["dashboard","▦","My dashboard"],["tracking","◎","Live tracking"]];
  $("navigation").innerHTML = items.map(([key,icon,label]) => `<button class="nav-btn ${page===key?"active":""}" data-page="${key}"><span>${icon}</span>${label}</button>`).join("");
  document.querySelectorAll(".nav-btn").forEach(b => b.onclick = () => { page = b.dataset.page; render(); });
  render();
}
async function render() {
  $("pageTitle").textContent = ({dashboard:"Dashboard",buses:"Bus management",routes:"Route management",allocation:"Student allocation",reports:"Reports",driver:"Trip controls",tracking:"Live bus tracking"})[page] || "Dashboard";
  $("content").innerHTML = `<div class="panel">Loading your transport information...</div>`;
  try {
    if (currentUser.role === "admin") await renderAdmin();
    else if (currentUser.role === "driver") await renderDriver();
    else await renderStudent();
  } catch (err) { $("content").innerHTML = `<div class="panel"><p class="message">${esc(err.message)}</p></div>`; }
  document.querySelectorAll("[data-action]").forEach(b => b.onclick = () => handleAction(b.dataset.action, b.dataset.id, b.dataset.status));
  document.querySelectorAll("form[data-form]").forEach(f => f.onsubmit = e => submitForm(e, f.dataset.form));
}
function statCard(label, value, note, icon) { return `<div class="stat"><span class="stat-icon">${icon}</span><div class="label">${label}</div><strong>${value}</strong><small>${note}</small></div>`; }
function statusPill(status) {
  const cls = /running|active|started|en route/i.test(status) ? "green" : /delay|maintenance/i.test(status) ? "amber" : /reached/i.test(status) ? "green" : "";
  return `<span class="pill ${cls}">${esc(status || "Not started")}</span>`;
}
function pageHead(title, desc, action="") { return `<div class="page-head"><div><h2>${title}</h2><p>${desc}</p></div>${action}</div>`; }
async function renderAdmin() {
  const [stats,buses,routes,allocations] = await Promise.all([
    api("/api/admin/summary"), api("/api/buses"), api("/api/routes"), api("/api/allocations")
  ]);
  cachedBuses=buses; cachedRoutes=routes;
  if (page === "dashboard") {
    $("content").innerHTML = `<div class="stats">${statCard("Total buses",stats.totalBuses,"Registered fleet","▣")}${statCard("Active routes",stats.activeRoutes,"Running routes","⌁")}${statCard("Students allocated",stats.studentsAllocated,"Transport assignments","♙")}${statCard("Buses en route",stats.busesEnRoute,"Currently on a trip","◎")}</div>
    <div class="grid-two"><section class="panel"><h3>Fleet overview</h3>${buses.length?`<div class="table-wrap"><table><thead><tr><th>Bus</th><th>Driver</th><th>Status</th></tr></thead><tbody>${buses.slice(0,6).map(b=>`<tr><td><b>${esc(b.busNumber)}</b></td><td>${esc(b.driverId?.name||"Not assigned")}</td><td>${statusPill(b.status)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">No buses added yet.</div>`}</section>
    <section class="panel"><h3>Route overview</h3>${routes.length?routes.slice(0,5).map(r=>`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><b style="font-size:12px">${esc(r.routeName)}</b><p class="muted-small">${esc((r.stops||[]).join(" → "))}</p>${statusPill(r.status)}</div>`).join(""):`<div class="empty">No routes created yet.</div>`}</section></div>`;
  } else if (page === "buses") {
    const drivers = await api("/api/users?role=driver"); cachedDrivers=drivers;
    $("content").innerHTML = `${pageHead("Add a bus","Register vehicles and assign a driver.")}<section class="panel"><form data-form="bus" class="form-grid"><div class="field"><label>Bus number</label><input name="busNumber" required placeholder="SR-02"></div><div class="field"><label>Capacity</label><input name="capacity" type="number" min="1" required placeholder="40"></div><div class="field"><label>Assign driver</label><select name="driverId"><option value="">Select driver</option>${drivers.map(d=>`<option value="${d._id}">${esc(d.name)}</option>`).join("")}</select></div><div class="field"><label>Bus status</label><select name="status"><option>Active</option><option>Maintenance</option></select></div><div class="wide form-actions"><button class="primary">Add bus</button></div></form></section>
    <div class="table-wrap"><table><thead><tr><th>Bus</th><th>Capacity</th><th>Driver</th><th>Fleet status</th><th>Trip status</th><th>Action</th></tr></thead><tbody>${buses.map(b=>`<tr><td><b>${esc(b.busNumber)}</b></td><td>${b.capacity}</td><td>${esc(b.driverId?.name||"—")}</td><td>${statusPill(b.status)}</td><td>${statusPill(b.tripStatus)}</td><td><button class="danger" data-action="delete-bus" data-id="${b._id}">Delete</button></td></tr>`).join("")||`<tr><td colspan="6" class="empty">No buses added.</td></tr>`}</tbody></table></div>`;
  } else if (page === "routes") {
    const drivers = await api("/api/users?role=driver");
    cachedDrivers = drivers;
    $("content").innerHTML = `${pageHead("Create a route","Select both a bus and a driver. You can also assign a driver to an existing route below.")}<section class="panel"><form data-form="route" class="form-grid"><div class="field"><label>Route name</label><input name="routeName" required placeholder="City Route"></div><div class="field"><label>Assign bus</label><select name="busId"><option value="">Select bus</option>${buses.map(b=>`<option value="${b._id}">${esc(b.busNumber)}</option>`).join("")}</select></div><div class="field"><label>Assign driver</label><select name="driverId"><option value="">Select driver</option>${drivers.map(d=>`<option value="${d._id}">${esc(d.name)} — ${esc(d.email)}</option>`).join("")}</select></div><div class="field wide"><label>Stops (separate each stop with a comma)</label><input name="stops" required placeholder="Main Gate, City Junction, Market Road, University"></div><div class="field wide"><label>Timings (optional, comma separated)</label><input name="timings" placeholder="07:30 AM, 07:45 AM, 08:00 AM"></div><div class="wide form-actions"><button class="primary">Create route</button></div></form></section>
    <div class="table-wrap"><table><thead><tr><th>Route</th><th>Stop sequence</th><th>Bus</th><th>Driver assignment</th><th>Status</th><th>Action</th></tr></thead><tbody>${routes.map(r=>`<tr><td><b>${esc(r.routeName)}</b></td><td>${esc((r.stops||[]).join(" → "))}</td><td>${esc(r.busId?.busNumber||"—")}</td><td><select class="control" id="route-driver-${r._id}" style="min-width:150px;padding:7px">${drivers.map(d=>`<option value="${d._id}" ${String(r.driverId?._id||"")===String(d._id)?"selected":""}>${esc(d.name)}</option>`).join("")||'<option value="">No drivers registered</option>'}</select><button class="small-btn" style="margin-top:5px" data-action="assign-route-driver" data-id="${r._id}">Save driver</button><div class="muted-small">${esc(r.driverId?.email||"")}</div></td><td>${statusPill(r.status)}</td><td><button class="danger" data-action="delete-route" data-id="${r._id}">Delete</button></td></tr>`).join("")||`<tr><td colspan="6" class="empty">No routes created.</td></tr>`}</tbody></table></div>`;
  } else if (page === "allocation") {
    const students=await api("/api/users?role=student"); cachedStudents=students;
    $("content").innerHTML = `${pageHead("Allocate students","Assign each student to a route and one of its stops.")}<section class="panel"><form data-form="allocation" class="form-grid"><div class="field"><label>Student</label><select name="studentId" required><option value="">Select student</option>${students.map(s=>`<option value="${s._id}">${esc(s.name)} — ${esc(s.email)}</option>`).join("")}</select></div><div class="field"><label>Route</label><select name="routeId" required><option value="">Select route</option>${routes.map(r=>`<option value="${r._id}">${esc(r.routeName)}</option>`).join("")}</select></div><div class="field wide"><label>Assigned stop (must match a stop in selected route)</label><input name="assignedStop" required placeholder="City Junction"></div><div class="wide form-actions"><button class="primary">Save allocation</button></div></form><p class="muted-small">If a student is assigned again, their previous allocation is updated.</p></section>
    <div class="table-wrap"><table><thead><tr><th>Student</th><th>Contact</th><th>Route</th><th>Assigned stop</th></tr></thead><tbody>${allocations.map(a=>`<tr><td><b>${esc(a.studentId?.name||"")}</b></td><td>${esc(a.studentId?.contact||"—")}</td><td>${esc(a.routeId?.routeName||"")}</td><td>${esc(a.assignedStop)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">No student allocations.</td></tr>`}</tbody></table></div>`;
  } else if (page === "reports") {
    $("content").innerHTML = `${pageHead("Transport report","Current summary of buses, routes and student assignments.")}<div class="stats">${statCard("Total buses",stats.totalBuses,"All registered buses","▣")}${statCard("Total students",stats.totalStudents,"Registered students","♙")}${statCard("Total drivers",stats.totalDrivers,"Registered drivers","♟")}${statCard("Allocated",stats.studentsAllocated,"Students with a route","✓")}</div><section class="panel"><h3>Allocation report</h3><div class="table-wrap"><table><thead><tr><th>Student</th><th>Email</th><th>Route</th><th>Pickup stop</th></tr></thead><tbody>${allocations.map(a=>`<tr><td>${esc(a.studentId?.name)}</td><td>${esc(a.studentId?.email)}</td><td>${esc(a.routeId?.routeName)}</td><td>${esc(a.assignedStop)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">No data yet.</td></tr>`}</tbody></table></div></section>`;
  }
}
async function renderDriver() {
  const route = await api("/api/driver/route"); const bus=route.busId;
  if (!bus) { $("content").innerHTML = `<div class="panel">Your route does not have a bus assigned yet.</div>`; return; }
  $("content").innerHTML = `${pageHead("Your assigned route","Update the simulated bus position as you complete each stop.")}<div class="stats">${statCard("Bus number",esc(bus.busNumber),"Assigned vehicle","▣")}${statCard("Trip status",esc(bus.tripStatus),"Current journey status","◎")}${statCard("Current stop",esc(bus.currentStop),"Last reported position","⌖")}${statCard("Next stop",esc(bus.nextStop||"Destination"),"Upcoming stop","⌁")}</div>
  <section class="panel"><h3>${esc(route.routeName)} — stop sequence</h3><div class="tracking">${route.stops.map((s,i)=>`<div class="track-stop ${s===bus.currentStop?"current":route.stops.indexOf(bus.currentStop)>i?"done":""}">${i+1}. ${esc(s)}</div>${i<route.stops.length-1?'<div class="track-line"></div>':""}`).join("")}</div><div class="notice">Use “Next stop” to simulate the bus moving forward. Students assigned to this route will see the updated position.</div><div class="inline-actions"><button class="primary" data-action="next-stop" data-id="${bus._id}">Next stop →</button><button class="secondary" data-action="start-trip" data-id="${bus._id}">Start trip</button><button class="secondary" data-action="end-trip" data-id="${bus._id}">End trip</button></div></section>
  <section class="panel"><h3>Update trip status</h3><div class="inline-actions"><button class="secondary" data-action="trip-status" data-id="${bus._id}" data-status="Started">Started</button><button class="secondary" data-action="trip-status" data-id="${bus._id}" data-status="En Route">En Route</button><button class="secondary" data-action="trip-status" data-id="${bus._id}" data-status="Reached Destination">Reached Destination</button></div></section>`;
}
async function renderStudent() {
  let allocation;
  try { allocation = await api(`/api/routes/student/${currentUser.id}`); }
  catch(err) { $("content").innerHTML = `<div class="panel"><h3>No route assigned</h3><p class="muted">${esc(err.message)}</p><p class="muted-small">Ask the transport administrator to allocate you to a route.</p></div>`; return; }
  const route=allocation.routeId, bus=route.busId;
  if (page === "tracking" && bus) {
    const status=await api(`/api/buses/${bus._id}/status`);
    $("content").innerHTML = `${pageHead("Live bus tracking","Simulated position updates from the assigned driver.")}<section class="panel"><div class="eyebrow">YOUR BUS · ${esc(bus.busNumber)}</div><div class="tracking-message">${esc(status.message)}</div><p class="muted">Current position: <b>${esc(status.bus.currentStop)}</b> ${status.bus.nextStop?`· Next: <b>${esc(status.bus.nextStop)}</b>`:""}</p><div class="tracking">${route.stops.map((s,i)=>`<div class="track-stop ${s===status.bus.currentStop?"current":route.stops.indexOf(status.bus.currentStop)>i?"done":""}">${i+1}. ${esc(s)}</div>${i<route.stops.length-1?'<div class="track-line"></div>':""}`).join("")}</div><div class="notice">This is simulated tracking. The position changes when the driver presses “Next stop”. This prototype does not use GPS.</div><button class="secondary" onclick="render()">Refresh status</button></section>`;
  } else {
    $("content").innerHTML = `${pageHead("My transport details","Your assigned university bus and pickup information.")}<div class="stats">${statCard("Route",esc(route.routeName),"Assigned route","⌁")}${statCard("Bus number",esc(bus?.busNumber||"Not assigned"),"Your vehicle","▣")}${statCard("Pickup stop",esc(allocation.assignedStop),"Your boarding point","⌖")}${statCard("Trip status",esc(bus?.tripStatus||"Not started"),"Latest status","◎")}</div><div class="grid-two"><section class="panel"><h3>Route and timings</h3><div class="stop-list">${route.stops.map((s,i)=>`<span class="stop">${i+1}. ${esc(s)} ${route.timings?.[i]?`· ${esc(route.timings[i])}`:""}</span>`).join("")}</div><p class="muted-small" style="margin-top:15px">Pickup stop: <b>${esc(allocation.assignedStop)}</b></p></section><section class="panel"><h3>Driver information</h3><p><b>${esc(route.driverId?.name||"Not assigned")}</b></p><p class="muted-small">Contact: ${esc(route.driverId?.contact||"Not available")}</p><p class="muted-small">Bus capacity: ${esc(bus?.capacity||"—")}</p><p class="muted-small">Route status: ${statusPill(route.status)}</p><button class="primary" onclick="page='tracking';render()">Track my bus</button></section></div>`;
  }
}
async function submitForm(e, type) {
  e.preventDefault(); const data=Object.fromEntries(new FormData(e.target).entries());
  try {
    if (type === "bus") await api("/api/buses",{method:"POST",body:JSON.stringify({...data,capacity:Number(data.capacity),driverId:data.driverId||null})});
    if (type === "route") await api("/api/routes",{method:"POST",body:JSON.stringify({...data,stops:data.stops.split(",").map(x=>x.trim()).filter(Boolean),timings:data.timings?data.timings.split(",").map(x=>x.trim()):[],driverId:data.driverId||null})});
    if (type === "allocation") await api("/api/routes/assign",{method:"POST",body:JSON.stringify(data)});
    toast("Saved successfully."); render();
  } catch(err) { toast(err.message); }
}
async function handleAction(action,id,status) {
  try {
    if (action==="assign-route-driver") {
      const driverId = document.getElementById(`route-driver-${id}`)?.value;
      if (!driverId) throw new Error("Register a driver account and select it first.");
      await api(`/api/routes/${id}`, { method:"PUT", body:JSON.stringify({ driverId }) });
    }
    if (action==="delete-bus" || action==="delete-route") {
      if (!confirm("Are you sure you want to delete this record?")) return;
      await api(action==="delete-bus"?`/api/buses/${id}`:`/api/routes/${id}`,{method:"DELETE"});
    }
    if (action==="next-stop") await api(`/api/buses/${id}/next-stop`,{method:"PUT",body:JSON.stringify({})});
    if (action==="start-trip") {
      const route=await api("/api/driver/route");
      await api(`/api/buses/${id}/location`,{method:"PUT",body:JSON.stringify({currentStop:route.stops[0],tripStatus:"Started"})});
    }
    if (action==="end-trip") {
      const route=await api("/api/driver/route");
      await api(`/api/buses/${id}/location`,{method:"PUT",body:JSON.stringify({currentStop:route.stops[route.stops.length-1],tripStatus:"Reached Destination"})});
    }
    if (action==="trip-status") {
      await api(`/api/buses/${id}/location`,{method:"PUT",body:JSON.stringify({tripStatus:status})});
    }
    toast("Update successful."); render();
  } catch(err) { toast(err.message); }
}
if (token && currentUser) boot();
