import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET =
  process.env.JWT_SECRET || "development-only-change-this-secret";

const STORE_LATITUDE = Number(process.env.STORE_LATITUDE || 17.3850);
const STORE_LONGITUDE = Number(process.env.STORE_LONGITUDE || 78.4867);
const DELIVERY_RADIUS_KM = Number(
  process.env.DELIVERY_RADIUS_KM || 30
);

// --------------------------------------------------
// FOLDERS
// --------------------------------------------------

const uploadsDir = path.join(__dirname, "uploads");
const dataDir = path.join(__dirname, "data");
const dbFile = path.join(dataDir, "store.json");

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

// --------------------------------------------------
// LOCAL JSON DATABASE
// --------------------------------------------------

function createEmptyDatabase() {
  return {
    users: [],
    products: [],
    orders: [],
    order_items: [],
    counters: {
      users: 1,
      products: 1,
      orders: 1,
      order_items: 1
    }
  };
}

function loadDatabase() {
  if (!fs.existsSync(dbFile)) {
    const database = createEmptyDatabase();
    fs.writeFileSync(dbFile, JSON.stringify(database, null, 2));
    return database;
  }

  try {
    return JSON.parse(fs.readFileSync(dbFile, "utf8"));
  } catch {
    console.log("Database file was invalid. Creating a new one.");
    const database = createEmptyDatabase();
    fs.writeFileSync(dbFile, JSON.stringify(database, null, 2));
    return database;
  }
}

let db = loadDatabase();

function saveDatabase() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function nextId(type) {
  const id = db.counters[type];
  db.counters[type]++;
  saveDatabase();
  return id;
}

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(cors());
app.use(express.json());

app.use(
  "/uploads",
  express.static(uploadsDir)
);

// --------------------------------------------------
// PASSWORD SECURITY
// --------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  try {
    const [salt, storedHash] = storedPassword.split(":");

    const hash = crypto
      .scryptSync(password, salt, 64)
      .toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(storedHash, "hex")
    );
  } catch {
    return false;
  }
}
// --------------------------------------------------
// INITIAL ADMIN SETUP
// --------------------------------------------------

function createInitialAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    return;
  }

  const existingAdmin = db.users.find(
    (user) => user.role === "admin"
  );

  if (existingAdmin) {
    return;
  }

  if (adminPassword.length < 6) {
    console.log("ADMIN_PASSWORD must be at least 6 characters.");
    return;
  }

  const admin = {
    id: nextId("users"),
    name: "Admin",
    email: adminEmail,
    password_hash: hashPassword(adminPassword),
    role: "admin",
    created_at: new Date().toISOString()
  };

  db.users.push(admin);
  saveDatabase();

  console.log("Initial admin account created.");
}

createInitialAdmin();

// --------------------------------------------------
// JWT
// --------------------------------------------------

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email
    },
    JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}

// --------------------------------------------------
// AUTH MIDDLEWARE
// --------------------------------------------------

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Login required"
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired session"
    });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      message: "Admin access required"
    });
  }

  next();
}

// --------------------------------------------------
// DISTANCE CALCULATION
// --------------------------------------------------

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) =>
    (degrees * Math.PI) / 180;

  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "clothing-store-api"
  });
});

// --------------------------------------------------
// REGISTER
// --------------------------------------------------

app.post("/api/auth/register", (req, res) => {
  const {
    name,
    email,
    password
  } = req.body;

  if (
    !name ||
    !email ||
    !password ||
    password.length < 6
  ) {
    return res.status(400).json({
      message:
        "Name, email and password (6+ chars) are required"
    });
  }

  const cleanEmail = email
    .toLowerCase()
    .trim();

  const existingUser = db.users.find(
    (user) => user.email === cleanEmail
  );

  if (existingUser) {
    return res.status(409).json({
      message: "Email already registered"
    });
  }

  const user = {
    id: nextId("users"),
    name: name.trim(),
    email: cleanEmail,
    password_hash: hashPassword(password),
    role: "customer",
    created_at: new Date().toISOString()
  };

  db.users.push(user);
  saveDatabase();

  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  res.status(201).json({
    user: safeUser,
    token: createToken(safeUser)
  });
});

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

app.post("/api/auth/login", (req, res) => {
  const {
    email,
    password
  } = req.body;

  const cleanEmail = email
    ?.toLowerCase()
    .trim();

  const user = db.users.find(
    (item) => item.email === cleanEmail
  );

  if (
    !user ||
    !verifyPassword(
      password || "",
      user.password_hash
    )
  ) {
    return res.status(401).json({
      message: "Invalid email or password"
    });
  }

  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  res.json({
    user: safeUser,
    token: createToken(safeUser)
  });
});

// --------------------------------------------------
// GET PRODUCTS
// --------------------------------------------------

app.get("/api/products", (req, res) => {
  const products = [...db.products]
    .sort((a, b) => b.id - a.id);

  res.json(products);
});

// --------------------------------------------------
// ADD PRODUCT - ADMIN ONLY
// --------------------------------------------------

app.post(
  "/api/products",
  auth,
  adminOnly,
  (req, res) => {
    const {
      name,
      description,
      price,
      category,
      sizes,
      stock,
      image_url
    } = req.body;

    if (
      !name ||
      Number(price) < 0 ||
      Number(stock) < 0
    ) {
      return res.status(400).json({
        message:
          "Valid name, price and stock are required"
      });
    }

    const product = {
      id: nextId("products"),
      name: name.trim(),
      description: description || "",
      price: Number(price),
      category: category || "Clothing",
      sizes: Array.isArray(sizes)
        ? sizes.join(",")
        : sizes || "S,M,L,XL",
      stock: Number(stock),
      image_url: image_url || "",
      created_at: new Date().toISOString()
    };

    db.products.push(product);
    saveDatabase();

    res.status(201).json(product);
  }
);

// --------------------------------------------------
// UPDATE PRODUCT - ADMIN ONLY
// --------------------------------------------------

app.put(
  "/api/products/:id",
  auth,
  adminOnly,
  (req, res) => {
    const productId = Number(req.params.id);

    const product = db.products.find(
      (item) => item.id === productId
    );

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    const {
      name,
      description,
      price,
      category,
      sizes,
      stock,
      image_url
    } = req.body;

    product.name = name ?? product.name;
    product.description =
      description ?? product.description;
    product.price =
      Number(price ?? product.price);
    product.category =
      category ?? product.category;

    product.sizes = Array.isArray(sizes)
      ? sizes.join(",")
      : sizes ?? product.sizes;

    product.stock =
      Number(stock ?? product.stock);

    product.image_url =
      image_url ?? product.image_url;

    saveDatabase();

    res.json(product);
  }
);

// --------------------------------------------------
// DELETE PRODUCT - ADMIN ONLY
// --------------------------------------------------

app.delete(
  "/api/products/:id",
  auth,
  adminOnly,
  (req, res) => {
    const productId = Number(req.params.id);

    const index = db.products.findIndex(
      (item) => item.id === productId
    );

    if (index === -1) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    db.products.splice(index, 1);

    saveDatabase();

    res.json({
      message: "Product deleted"
    });
  }
);

// --------------------------------------------------
// DELIVERY CHECK
// --------------------------------------------------

app.post(
  "/api/delivery/check",
  async (req, res) => {
    const {
      village,
      address
    } = req.body;

    if (!village || !address) {
      return res.status(400).json({
        message: "Village/Town and complete address are required"
      });
    }

    try {
      const searchText = `${address}, ${village}, Telangana, India`;

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchText)}`,
        {
          headers: {
            "User-Agent": "ClothCraft/1.0"
          }
        }
      );

      const locations = await response.json();

      if (!locations.length) {
        return res.status(400).json({
          message:
            "Location not found. Please check your village/town name and address."
        });
      }

      const latitude = Number(locations[0].lat);
      const longitude = Number(locations[0].lon);

      const distance = distanceKm(
        STORE_LATITUDE,
        STORE_LONGITUDE,
        latitude,
        longitude
      );

      res.json({
        eligible: distance <= DELIVERY_RADIUS_KM,
        distanceKm: Number(distance.toFixed(2)),
        radiusKm: DELIVERY_RADIUS_KM,
        latitude,
        longitude
      });
    } catch (error) {
      console.error("Geocoding error:", error);

      res.status(500).json({
        message: "Unable to check this location right now."
      });
    }
  }
);
// --------------------------------------------------
// CREATE ORDER
// --------------------------------------------------

app.post(
  "/api/orders",
  auth,
  (req, res) => {
    const {
      items,
      address,
      latitude,
      longitude
    } = req.body;

    if (
      !Array.isArray(items) ||
      !items.length ||
      !address
    ) {
      return res.status(400).json({
        message:
          "Items and address are required"
      });
    }

    if (
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude))
    ) {
      return res.status(400).json({
        message:
          "Valid delivery coordinates are required"
      });
    }

    const distance = distanceKm(
      STORE_LATITUDE,
      STORE_LONGITUDE,
      Number(latitude),
      Number(longitude)
    );

    // SERVER-SIDE 30 KM CHECK
    if (distance > DELIVERY_RADIUS_KM) {
      return res.status(400).json({
        message:
          `Delivery is available only within ${DELIVERY_RADIUS_KM} km of the store.`,
        distanceKm:
          Number(distance.toFixed(2))
      });
    }

    let total = 0;

    const checkedItems = [];

    for (const item of items) {
      const product = db.products.find(
        (product) =>
          product.id === Number(item.product_id)
      );

      const quantity =
        Number(item.quantity);

      if (
        !product ||
        quantity < 1 ||
        quantity > product.stock
      ) {
        return res.status(400).json({
          message:
            `Invalid stock for product ${item.product_id}`
        });
      }

      total +=
        product.price * quantity;

      checkedItems.push({
        product_id: product.id,
        size: item.size || "M",
        quantity,
        price: product.price
      });
    }

    const orderId =
      nextId("orders");

    const order = {
      id: orderId,
      user_id: req.user.id,
      total,
      address,
      latitude: Number(latitude),
      longitude: Number(longitude),
      distance_km: distance,
      payment_status: "pending",
      status: "placed",
      created_at:
        new Date().toISOString()
    };

    db.orders.push(order);

    for (const item of checkedItems) {
      db.order_items.push({
        id: nextId("order_items"),
        order_id: orderId,
        product_id: item.product_id,
        size: item.size,
        quantity: item.quantity,
        price: item.price
      });

      const product =
        db.products.find(
          (p) =>
            p.id === item.product_id
        );

      product.stock -=
        item.quantity;
    }

    saveDatabase();

    res.status(201).json({
      orderId,
      total,
      paymentStatus: "pending"
    });
  }
);

// --------------------------------------------------
// CUSTOMER ORDERS
// --------------------------------------------------

app.get(
  "/api/orders/my",
  auth,
  (req, res) => {
    const orders = db.orders
      .filter(
        (order) =>
          order.user_id === req.user.id
      )
      .sort(
        (a, b) => b.id - a.id
      );

    res.json(orders);
  }
);

// --------------------------------------------------
// ADMIN ORDERS
// --------------------------------------------------

app.get(
  "/api/admin/orders",
  auth,
  adminOnly,
  (req, res) => {
    const orders = db.orders
      .map((order) => {
        const customer =
          db.users.find(
            (user) =>
              user.id === order.user_id
          );

        return {
          ...order,
          customer_name:
            customer?.name || "",
          customer_email:
            customer?.email || ""
        };
      })
      .sort(
        (a, b) => b.id - a.id
      );

    res.json(orders);
  }
);

// --------------------------------------------------
// UPDATE ORDER STATUS - ADMIN
// --------------------------------------------------

app.patch(
  "/api/admin/orders/:id",
  auth,
  adminOnly,
  (req, res) => {
    const allowedStatuses = [
      "placed",
      "confirmed",
      "packed",
      "out_for_delivery",
      "delivered",
      "cancelled"
    ];

    const {
      status
    } = req.body;

    if (
      !allowedStatuses.includes(status)
    ) {
      return res.status(400).json({
        message: "Invalid status"
      });
    }

    const order =
      db.orders.find(
        (item) =>
          item.id ===
          Number(req.params.id)
      );

    if (!order) {
      return res.status(404).json({
        message: "Order not found"
      });
    }

    order.status = status;

    saveDatabase();

    res.json({
      message: "Order updated"
    });
  }
);

// --------------------------------------------------
// IMAGE UPLOAD
// --------------------------------------------------

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

app.post(
  "/api/admin/upload",
  auth,
  adminOnly,
  upload.single("image"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        message: "Image required"
      });
    }

    const imageUrl =
      `/uploads/${req.file.filename}`;

    res.json({
      imageUrl
    });
  }
);

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(
  PORT,
  () => {
    console.log(
      `Backend running on http://localhost:${PORT}`
    );

    console.log(
      `Delivery radius: ${DELIVERY_RADIUS_KM} km`
    );
  }
);