import React from "react";
import { useEffect, useMemo, useState } from "react";
import { api, API_URL } from "./api";
import "./App.css";

const emptyProduct = {
  name: "",
  description: "",
  price: "",
  category: "Kurtis",
  sizes: "S,M,L,XL",
  stock: "",
  image_url: ""
};

function App() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("user") || "null"));
  const [page, setPage] = useState("shop");
  const [authMode, setAuthMode] = useState("login");
  const [auth, setAuth] = useState({ name: "", email: "", password: "" });
  const [search, setSearch] = useState("");
  const [productForm, setProductForm] = useState(emptyProduct);
  const [imageFile, setImageFile] = useState(null);
  const [message, setMessage] = useState("");
  const [orders, setOrders] = useState([]);

  async function loadProducts() {
    try { setProducts(await api("/api/products")); }
    catch (e) { setMessage(e.message); }
  }

  useEffect(() => { loadProducts(); }, []);

  const filtered = useMemo(
    () => products.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase())
    ),
    [products, search]
  );

  function addToCart(product) {
    setCart(c => {
      const existing = c.find(x => x.id === product.id);
      if (existing) return c.map(x => x.id === product.id ? { ...x, quantity: x.quantity + 1 } : x);
      return [...c, { ...product, quantity: 1, size: product.sizes.split(",")[0] }];
    });
    setMessage("Added to cart");
  }

  function logout() {
    localStorage.clear();
    setUser(null);
    setPage("shop");
  }

  async function submitAuth(e) {
    e.preventDefault();
    try {
      const data = await api(`/api/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify(auth)
      });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      setPage(data.user.role === "admin" ? "admin" : "shop");
      setMessage("Welcome!");
    } catch (e) { setMessage(e.message); }
  }

  async function saveProduct(e) {
  e.preventDefault();

  try {
    let imageUrl = "";

    if (imageFile) {
      const formData = new FormData();
      formData.append("image", imageFile);

      const uploadResult = await api("/api/admin/upload", {
        method: "POST",
        body: formData
      });

      imageUrl = uploadResult.imageUrl;
    }

    await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        ...productForm,
        image_url: imageUrl,
        price: Number(productForm.price),
        stock: Number(productForm.stock)
      })
    });

    setProductForm(emptyProduct);
    setImageFile(null);
    await loadProducts();

    setMessage("Product added successfully!");
  } catch (e) {
    setMessage(e.message);
  }
}
    

  async function deleteProduct(id) {
    if (!confirm("Delete this product?")) return;
    try {
      await api(`/api/products/${id}`, { method: "DELETE" });
      await loadProducts();
    } catch (e) { setMessage(e.message); }
  }

  async function loadOrders() {
    try {
      const data = await api(user?.role === "admin" ? "/api/admin/orders" : "/api/orders/my");
      setOrders(data);
    } catch (e) { setMessage(e.message); }
  }

  async function checkout() {
    if (!user) {
      setPage("auth");
      setMessage("Please login before checkout.");
      return;
    }
    const latitude = Number(prompt("Enter your delivery latitude (we will add a map picker later):"));
    const longitude = Number(prompt("Enter your delivery longitude:"));
    const address = prompt("Enter your complete delivery address:");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !address) return;

    try {
      const check = await api("/api/delivery/check", {
        method: "POST",
        body: JSON.stringify({ latitude, longitude })
      });
      if (!check.eligible) {
        setMessage(`Delivery unavailable. Your location is ${check.distanceKm} km away.`);
        return;
      }

      const order = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map(i => ({
            product_id: i.id,
            size: i.size,
            quantity: i.quantity
          })),
          address,
          latitude,
          longitude
        })
      });

      setCart([]);
      setPage("orders");
      await loadOrders();
      setMessage(`Order #${order.orderId} created. Payment integration will be connected next.`);
    } catch (e) { setMessage(e.message); }
  }

  async function updateOrder(id, status) {
    try {
      await api(`/api/admin/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      loadOrders();
    } catch (e) { setMessage(e.message); }
  }

  return (
    <div className="app">
      <header className="header">
        <button className="brand" onClick={() => setPage("shop")}>My Clothing Store</button>
        <nav>
          <button onClick={() => setPage("shop")}>Shop</button>
          {user && <button onClick={() => { setPage("orders"); loadOrders(); }}>Orders</button>}
          {user?.role === "admin" && <button onClick={() => setPage("admin")}>Admin</button>}
          {!user ? <button onClick={() => setPage("auth")}>Login</button> : <button onClick={logout}>Logout</button>}
          <button className="cart" onClick={() => setPage("cart")}>Cart ({cart.reduce((s, i) => s + i.quantity, 0)})</button>
        </nav>
      </header>

      {message && <div className="message">{message}<button onClick={() => setMessage("")}>×</button></div>}

      {page === "shop" && (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">LOCAL FASHION • FAST DELIVERY</p>
              <h1>Style delivered to your doorstep.</h1>
              <p>Shop clothes from our local store. Delivery is available within 30 km.</p>
              <button className="primary" onClick={() => document.getElementById("products").scrollIntoView({behavior:"smooth"})}>Shop now</button>
            </div>
          </section>

          <main id="products" className="container">
            <div className="section-title">
              <div><p className="eyebrow">COLLECTION</p><h2>Latest products</h2></div>
              <input placeholder="Search clothes..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div className="grid">
              {filtered.map(product => (
                <article className="card" key={product.id}>
                  <div className="image-wrap">
                    {product.image_url ? <img src={product.image_url.startsWith("http") ? product.image_url : `${API_URL}${product.image_url}`} alt={product.name} /> : <div className="placeholder">No image</div>}
                  </div>
                  <div className="card-body">
                    <small>{product.category}</small>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>
                    <div className="row"><strong>₹{product.price}</strong><span>{product.stock} left</span></div>
                    <button className="primary full" disabled={!product.stock} onClick={() => addToCart(product)}>
                      {product.stock ? "Add to cart" : "Sold out"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </main>
        </>
      )}

      {page === "auth" && (
        <main className="auth-page">
          <form className="panel" onSubmit={submitAuth}>
            <p className="eyebrow">ACCOUNT</p>
            <h2>{authMode === "login" ? "Welcome back" : "Create your account"}</h2>
            {authMode === "register" && <input required placeholder="Full name" value={auth.name} onChange={e => setAuth({...auth,name:e.target.value})} />}
            <input required type="email" placeholder="Email" value={auth.email} onChange={e => setAuth({...auth,email:e.target.value})} />
            <input required minLength="6" type="password" placeholder="Password (6+ characters)" value={auth.password} onChange={e => setAuth({...auth,password:e.target.value})} />
            <button className="primary full">{authMode === "login" ? "Login" : "Register"}</button>
            <button type="button" className="link" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
              {authMode === "login" ? "Create an account" : "Already have an account? Login"}
            </button>
          </form>
        </main>
      )}

      {page === "cart" && (
        <main className="container page">
          <h2>Your cart</h2>
          {!cart.length ? <p>Your cart is empty.</p> : <>
            {cart.map(item => (
              <div className="cart-item" key={item.id}>
                <div><strong>{item.name}</strong><span>₹{item.price} × {item.quantity}</span></div>
                <select value={item.size} onChange={e => setCart(cart.map(x => x.id === item.id ? {...x,size:e.target.value}:x))}>
                  {item.sizes.split(",").map(s => <option key={s}>{s}</option>)}
                </select>
                <button onClick={() => setCart(cart.filter(x => x.id !== item.id))}>Remove</button>
              </div>
            ))}
            <div className="checkout"><h3>Total: ₹{cart.reduce((s,i)=>s+i.price*i.quantity,0)}</h3><button className="primary" onClick={checkout}>Checkout</button></div>
          </>}
        </main>
      )}

      {page === "admin" && user?.role === "admin" && (
  <main className="container page">
    <div className="section-title">
      <div>
        <p className="eyebrow">ADMIN</p>
        <h2>Manage products</h2>
      </div>
    </div>

    <form className="panel" onSubmit={saveProduct}>
      <h3>Add new product</h3>

      <input
        required
        placeholder="Product name"
        value={productForm.name}
        onChange={e =>
          setProductForm({...productForm, name: e.target.value})
        }
      />

      <textarea
        required
        placeholder="Product description"
        value={productForm.description}
        onChange={e =>
          setProductForm({...productForm, description: e.target.value})
        }
      />

      <input
        required
        type="number"
        min="0"
        placeholder="Price (₹)"
        value={productForm.price}
        onChange={e =>
          setProductForm({...productForm, price: e.target.value})
        }
      />

      <input
        required
        type="number"
        min="0"
        placeholder="Stock quantity"
        value={productForm.stock}
        onChange={e =>
          setProductForm({...productForm, stock: e.target.value})
        }
      />

      <select
        value={productForm.category}
        onChange={e =>
          setProductForm({...productForm, category: e.target.value})
        }
      >
        <option>Kurtis</option>
        <option>Dresses</option>
        <option>Sarees</option>
        <option>Tops</option>
        <option>Shirts</option>
        <option>Pants</option>
        <option>Jeans</option>
        <option>Kids Wear</option>
        <option>Other</option>
      </select>

      <input
        placeholder="Sizes (example: S,M,L,XL)"
        value={productForm.sizes}
        onChange={e =>
          setProductForm({...productForm, sizes: e.target.value})
        }
      />

      <label>
        <strong>Product image</strong>
      </label>

      <input
        type="file"
        accept="image/*"
        onChange={e => setImageFile(e.target.files[0] || null)}
      />

      {imageFile && (
        <p>
          Selected image: <strong>{imageFile.name}</strong>
        </p>
      )}

      <button className="primary full" type="submit">
        Add Product
      </button>
    </form>

    <div className="page">
      <h3>Existing products</h3>

      {products.map(product => (
        <div className="order" key={product.id}>
          <div>
            <strong>{product.name}</strong>
            <span>₹{product.price}</span>
          </div>

          <div>
            Stock: {product.stock} · Category: {product.category}
          </div>

          <button onClick={() => deleteProduct(product.id)}>
            Delete
          </button>
        </div>
      ))}
    </div>
  </main>
)}
{page === "orders" && (
        <main className="container page">
          <div className="section-title"><div><p className="eyebrow">ORDERS</p><h2>{user?.role === "admin" ? "All orders" : "My orders"}</h2></div><button onClick={loadOrders}>Refresh</button></div>
          {!orders.length ? <p>No orders yet.</p> : orders.map(o => (
            <div className="order" key={o.id}>
              <div><strong>Order #{o.id}</strong><span>{new Date(o.created_at).toLocaleString()}</span></div>
              {user?.role === "admin" && <div>{o.customer_name} · {o.customer_email}</div>}
              <div>₹{o.total} · {o.distance_km.toFixed ? o.distance_km.toFixed(2) : o.distance_km} km · <b>{o.status}</b></div>
              {user?.role === "admin" && <select value={o.status} onChange={e => updateOrder(o.id,e.target.value)}>
                {["placed","confirmed","packed","out_for_delivery","delivered","cancelled"].map(s => <option key={s}>{s}</option>)}
              </select>}
            </div>
          ))}
        </main>
      )}
              </div>
  );
}

export default App;