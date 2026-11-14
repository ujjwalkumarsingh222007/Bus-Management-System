const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

const PORT = 5000;
const MONGODB_URI = "mongodb://127.0.0.1:27017";
const DB_NAME = "sr_bus_management";
const client = new MongoClient(MONGODB_URI);
let db;

// Simple in-memory login tokens for this simulated hackathon project.
const sessions = new Map();

const id = value => {
  try { return new ObjectId(value); } catch { return null; }
};
const hashPassword = password => crypto.pbkdf2Sync(password, "sr-bus-project", 10000, 64, "sha512").toString("hex");
const makeToken = user => {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { id: String(user._id), name: user.name, email: user.email, role: user.role });
  return token;
};
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  const user = sessions.get(token);
  if (!user) return res.status(401).json({ message: "Login required. Please log in again." });
  req.user = user;
  next();
}
const allow = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: "You do not have permission for this action." });
  next();
};
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = user => {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
};
async function getRouteWithDetails(route) {
  if (!route) return null;
  const [bus, driver] = await Promise.all([
    route.busId ? db.collection("buses").findOne({ _id: route.busId }) : null,
    route.driverId ? db.collection("users").findOne({ _id: route.driverId }) : null
  ]);
  return { ...route, busId: bus, driverId: driver ? publicUser(driver) : null };
}

// Authentication: registration and login for admin, driver and student.
app.post("/api/auth/register", asyncHandler(async (req, res) => {
  const { name, email, password, role, contact = "", address = "" } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ message: "Name, email, password and role are required." });
  if (!["admin", "driver", "student"].includes(role)) return res.status(400).json({ message: "Select a valid role." });
  if (password.length < 6) return res.status(400).json({ message: "Password must contain at least 6 characters." });
  const normalizedEmail = email.toLowerCase().trim();
  if (await db.collection("users").findOne({ email: normalizedEmail })) return res.status(409).json({ message: "Email already registered." });
  const user = { name: name.trim(), email: normalizedEmail, password: hashPassword(password), role, contact, address };
  const result = await db.collection("users").insertOne(user);
  res.status(201).json({ message: "Registration successful. You can now log in.", user: { id: String(result.insertedId), name, email: normalizedEmail, role } });
}));
app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const user = await db.collection("users").findOne({ email: String(req.body.email || "").toLowerCase().trim() });
  if (!user || hashPassword(req.body.password || "") !== user.password) return res.status(401).json({ message: "Invalid email or password." });
  res.json({ token: makeToken(user), user: { id: String(user._id), name: user.name, email: user.email, role: user.role } });
}));
app.get("/api/auth/me", auth, asyncHandler(async (req, res) => {
  const user = await db.collection("users").findOne({ _id: id(req.user.id) });
  res.json({ user: publicUser(user) });
}));

app.get("/api/users", auth, allow("admin"), asyncHandler(async (req, res) => {
  const users = await db.collection("users").find({ role: req.query.role }).project({ password: 0 }).sort({ name: 1 }).toArray();
  res.json(users);
}));

// Bus management
app.post("/api/buses", auth, allow("admin"), asyncHandler(async (req, res) => {
  const { busNumber, capacity, driverId = null, status = "Active" } = req.body;
  if (!busNumber || !capacity) return res.status(400).json({ message: "Bus number and capacity are required." });
  const bus = { busNumber, capacity: Number(capacity), driverId: id(driverId), status, currentStop: "Not started", tripStatus: "Not Started", nextStop: "", remarks: "" };
  const result = await db.collection("buses").insertOne(bus);
  res.status(201).json({ ...bus, _id: result.insertedId });
}));
app.get("/api/buses", auth, allow("admin"), asyncHandler(async (req, res) => {
  const buses = await db.collection("buses").find().sort({ busNumber: 1 }).toArray();
  const output = await Promise.all(buses.map(async bus => {
    const driver = bus.driverId ? await db.collection("users").findOne({ _id: bus.driverId }) : null;
    return { ...bus, driverId: driver ? publicUser(driver) : null };
  }));
  res.json(output);
}));
app.put("/api/buses/:id", auth, allow("admin"), asyncHandler(async (req, res) => {
  const result = await db.collection("buses").findOneAndUpdate({ _id: id(req.params.id) }, { $set: req.body }, { returnDocument: "after" });
  if (!result) return res.status(404).json({ message: "Bus not found." });
  res.json(result);
}));
app.delete("/api/buses/:id", auth, allow("admin"), asyncHandler(async (req, res) => {
  const busId = id(req.params.id);
  if (await db.collection("routes").findOne({ busId })) return res.status(400).json({ message: "Remove this bus from its route before deleting it." });
  await db.collection("buses").deleteOne({ _id: busId });
  res.json({ message: "Bus deleted." });
}));

// Route management
app.post("/api/routes", auth, allow("admin"), asyncHandler(async (req, res) => {
  const { routeName, stops, timings = [], busId = null, driverId = null } = req.body;
  if (!routeName || !Array.isArray(stops) || stops.filter(Boolean).length < 2) return res.status(400).json({ message: "Enter a route name and at least two stops." });
  const bus = busId ? await db.collection("buses").findOne({ _id: id(busId) }) : null;
  if (busId && !bus) return res.status(404).json({ message: "Selected bus not found." });
  const selectedDriverId = id(driverId) || bus?.driverId || null;
  if (selectedDriverId) {
    const selectedDriver = await db.collection("users").findOne({ _id: selectedDriverId, role: "driver" });
    if (!selectedDriver) return res.status(400).json({ message: "Selected driver account was not found. Register the driver first." });
  }
  const route = { routeName, stops: stops.map(s => s.trim()).filter(Boolean), timings, busId: id(busId), driverId: selectedDriverId, status: "Running" };
  const result = await db.collection("routes").insertOne(route);
  if (busId && selectedDriverId) await db.collection("buses").updateOne({ _id: id(busId) }, { $set: { driverId: selectedDriverId } });
  res.status(201).json({ ...route, _id: result.insertedId });
}));
app.get("/api/routes", auth, asyncHandler(async (req, res) => {
  const routes = await db.collection("routes").find().sort({ routeName: 1 }).toArray();
  res.json(await Promise.all(routes.map(getRouteWithDetails)));
}));
app.put("/api/routes/:id", auth, allow("admin"), asyncHandler(async (req, res) => {
  const routeId = id(req.params.id);
  const update = { ...req.body };
  if (update.busId) update.busId = id(update.busId);
  if (update.driverId) {
    update.driverId = id(update.driverId);
    const selectedDriver = await db.collection("users").findOne({ _id: update.driverId, role: "driver" });
    if (!selectedDriver) return res.status(400).json({ message: "Selected driver account was not found. Register the driver first." });
  }
  const result = await db.collection("routes").findOneAndUpdate({ _id: routeId }, { $set: update }, { returnDocument: "after" });
  if (!result) return res.status(404).json({ message: "Route not found." });
  if (update.driverId && result.busId) {
    await db.collection("buses").updateOne({ _id: result.busId }, { $set: { driverId: update.driverId } });
  }
  res.json(await getRouteWithDetails(result));
}));
app.delete("/api/routes/:id", auth, allow("admin"), asyncHandler(async (req, res) => {
  const routeId = id(req.params.id);
  await db.collection("allocations").deleteMany({ routeId });
  await db.collection("routes").deleteOne({ _id: routeId });
  res.json({ message: "Route and its student allocations deleted." });
}));

// Student allocation
app.post("/api/routes/assign", auth, allow("admin"), asyncHandler(async (req, res) => {
  const studentId = id(req.body.studentId), routeId = id(req.body.routeId), assignedStop = req.body.assignedStop;
  const [student, route] = await Promise.all([
    db.collection("users").findOne({ _id: studentId, role: "student" }),
    db.collection("routes").findOne({ _id: routeId })
  ]);
  if (!student || !route) return res.status(404).json({ message: "Student or route not found." });
  if (!route.stops.includes(assignedStop)) return res.status(400).json({ message: "Assigned stop must be part of the selected route." });
  await db.collection("allocations").updateOne({ studentId }, { $set: { studentId, routeId, assignedStop, createdAt: new Date() } }, { upsert: true });
  res.status(201).json({ message: "Student allocated successfully." });
}));
app.get("/api/allocations", auth, allow("admin"), asyncHandler(async (req, res) => {
  const allocations = await db.collection("allocations").find().sort({ createdAt: -1 }).toArray();
  res.json(await Promise.all(allocations.map(async a => {
    const [student, route] = await Promise.all([
      db.collection("users").findOne({ _id: a.studentId }),
      db.collection("routes").findOne({ _id: a.routeId })
    ]);
    return { ...a, studentId: publicUser(student), routeId: route };
  })));
}));
app.get("/api/routes/student/:studentId", auth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin" && req.user.id !== req.params.studentId) return res.status(403).json({ message: "You can only view your own route." });
  const allocation = await db.collection("allocations").findOne({ studentId: id(req.params.studentId) });
  if (!allocation) return res.status(404).json({ message: "No route assigned yet. Please contact transport administration." });
  const route = await getRouteWithDetails(await db.collection("routes").findOne({ _id: allocation.routeId }));
  if (!route) return res.status(404).json({ message: "Assigned route not found." });
  res.json({ ...allocation, routeId: route });
}));

// Driver route and simulated bus tracking
app.get("/api/driver/route", auth, allow("driver"), asyncHandler(async (req, res) => {
  const route = await db.collection("routes").findOne({ driverId: id(req.user.id) });
  if (!route) return res.status(404).json({ message: "No route has been assigned to you." });
  res.json(await getRouteWithDetails(route));
}));
app.put("/api/buses/:id/location", auth, allow("driver", "admin"), asyncHandler(async (req, res) => {
  const busId = id(req.params.id);
  const bus = await db.collection("buses").findOne({ _id: busId });
  if (!bus) return res.status(404).json({ message: "Bus not found." });
  const route = await db.collection("routes").findOne({ busId });
  if (!route) return res.status(400).json({ message: "This bus is not assigned to a route." });
  if (req.user.role === "driver" && String(route.driverId) !== req.user.id) return res.status(403).json({ message: "This bus is not assigned to you." });
  const { currentStop, tripStatus, remarks } = req.body;
  if (currentStop && !route.stops.includes(currentStop)) return res.status(400).json({ message: "Selected stop is not part of this route." });
  const set = {};
  if (currentStop) {
    const index = route.stops.indexOf(currentStop);
    set.currentStop = currentStop;
    set.nextStop = route.stops[index + 1] || "";
    if (!tripStatus) set.tripStatus = index === route.stops.length - 1 ? "Reached Destination" : "En Route";
  }
  if (tripStatus) set.tripStatus = tripStatus;
  if (remarks !== undefined) set.remarks = remarks;
  const updated = await db.collection("buses").findOneAndUpdate({ _id: busId }, { $set: set }, { returnDocument: "after" });
  await db.collection("locationlogs").insertOne({ busId, timestamp: new Date(), currentStop: updated.currentStop, nextStop: updated.nextStop, remarks: updated.remarks });
  res.json({ message: "Simulated bus location updated.", bus: updated });
}));
app.put("/api/buses/:id/next-stop", auth, allow("driver", "admin"), asyncHandler(async (req, res) => {
  const busId = id(req.params.id);
  const bus = await db.collection("buses").findOne({ _id: busId });
  if (!bus) return res.status(404).json({ message: "Bus not found." });
  const route = await db.collection("routes").findOne({ busId });
  if (!route) return res.status(400).json({ message: "No route is assigned to this bus." });
  if (req.user.role === "driver" && String(route.driverId) !== req.user.id) return res.status(403).json({ message: "This bus is not assigned to you." });
  const currentIndex = route.stops.indexOf(bus.currentStop);
  const nextIndex = bus.currentStop === "Not started" ? 0 : currentIndex + 1;
  let set;
  if (nextIndex >= route.stops.length) set = { tripStatus: "Reached Destination", nextStop: "" };
  else set = { currentStop: route.stops[nextIndex], nextStop: route.stops[nextIndex + 1] || "", tripStatus: nextIndex === route.stops.length - 1 ? "Reached Destination" : "En Route" };
  if (bus.tripStatus === "Not Started") set.tripStatus = "Started";
  const updated = await db.collection("buses").findOneAndUpdate({ _id: busId }, { $set: set }, { returnDocument: "after" });
  await db.collection("locationlogs").insertOne({ busId, timestamp: new Date(), currentStop: updated.currentStop, nextStop: updated.nextStop, remarks: updated.remarks });
  res.json({ message: "Bus moved to the next stop.", bus: updated });
}));
app.get("/api/buses/:id/status", auth, allow("student", "admin"), asyncHandler(async (req, res) => {
  const busId = id(req.params.id);
  const bus = await db.collection("buses").findOne({ _id: busId });
  if (!bus) return res.status(404).json({ message: "Bus not found." });
  const route = await db.collection("routes").findOne({ busId });
  if (req.user.role === "student") {
    const allocation = await db.collection("allocations").findOne({ studentId: id(req.user.id) });
    if (!allocation || String(route?._id) !== String(allocation.routeId)) return res.status(403).json({ message: "This bus is not assigned to you." });
  }
  const allocation = req.user.role === "student" ? await db.collection("allocations").findOne({ studentId: id(req.user.id) }) : null;
  const currentIndex = route ? route.stops.indexOf(bus.currentStop) : -1;
  const studentIndex = allocation && route ? route.stops.indexOf(allocation.assignedStop) : -1;
  const stopsAway = currentIndex >= 0 && studentIndex >= 0 ? Math.max(0, studentIndex - currentIndex) : null;
  res.json({ bus, route, stopsAway, message: stopsAway === null ? "Location update is not available yet." : stopsAway === 0 ? "Bus is at your stop." : `Bus is ${stopsAway} stop${stopsAway === 1 ? "" : "s"} away from your stop.` });
}));
app.get("/api/buses/:id/logs", auth, asyncHandler(async (req, res) => {
  const busId = id(req.params.id);
  if (req.user.role === "student") {
    const allocation = await db.collection("allocations").findOne({ studentId: id(req.user.id) });
    const route = allocation ? await db.collection("routes").findOne({ _id: allocation.routeId }) : null;
    if (!route || String(route.busId) !== String(busId)) return res.status(403).json({ message: "This bus is not assigned to you." });
  } else if (req.user.role !== "admin" && req.user.role !== "driver") return res.status(403).json({ message: "Not allowed." });
  res.json(await db.collection("locationlogs").find({ busId }).sort({ timestamp: -1 }).limit(20).toArray());
}));

// Admin dashboard summary
app.get("/api/admin/summary", auth, allow("admin"), asyncHandler(async (req, res) => {
  const [totalBuses, activeRoutes, studentsAllocated, busesEnRoute, totalStudents, totalDrivers] = await Promise.all([
    db.collection("buses").countDocuments(),
    db.collection("routes").countDocuments({ status: "Running" }),
    db.collection("allocations").countDocuments(),
    db.collection("buses").countDocuments({ tripStatus: { $in: ["Started", "En Route"] } }),
    db.collection("users").countDocuments({ role: "student" }),
    db.collection("users").countDocuments({ role: "driver" })
  ]);
  res.json({ totalBuses, activeRoutes, studentsAllocated, busesEnRoute, totalStudents, totalDrivers });
}));
app.get("/api/health", (req, res) => res.json({ status: "ok", service: "SR University Bus Management API" }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 11000) return res.status(409).json({ message: "A record with this value already exists." });
  res.status(500).json({ message: "Server error. Check the terminal for details." });
});

async function start() {
  try {
    await client.connect();
    db = client.db(DB_NAME);
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("buses").createIndex({ busNumber: 1 }, { unique: true });
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
}
start();
