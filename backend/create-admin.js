import fs from "fs";
import path from "path";
import crypto from "crypto";

const dataDir = path.join(process.cwd(), "data");
const dbFile = path.join(dataDir, "store.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = {
  users: [],
  products: [],
  orders: [],
  order_items: []
};

if (fs.existsSync(dbFile)) {
  db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
}

const name = "Admin";
const email = "admin@clothcraft.com";
const password = "Admin12345";

const existingUser = db.users.find(
  user => user.email.toLowerCase() === email.toLowerCase()
);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

if (existingUser) {
  existingUser.role = "admin";
  existingUser.password_hash = hashPassword(password);
  console.log("Existing account changed to ADMIN.");
} else {
  db.users.push({
    id: crypto.randomUUID(),
    name,
    email,
    password_hash: hashPassword(password),
    role: "admin",
    created_at: new Date().toISOString()
  });

  console.log("Admin account created.");
}

fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

console.log("");
console.log("ADMIN LOGIN");
console.log("Email: " + email);
console.log("Password: " + password);
console.log("");