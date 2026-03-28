// ============================================
// firebase-config.js — 共用 Firebase 初始化
// ============================================

const firebaseConfig = {
  apiKey: "AIzaSyBYKtAPD0pin5B-1ctXIOj6CE1AO_VfHaE",
  authDomain: "hinoki-17ffe.firebaseapp.com",
  projectId: "hinoki-17ffe",
  storageBucket: "hinoki-17ffe.firebasestorage.app",
  messagingSenderId: "894705167512",
  appId: "1:894705167512:web:f4cee2ee1d1fe6a75cf4ed",
  measurementId: "G-9GZKEV6EML"
};

// Firebase SDK (compat version via CDN — loaded in each HTML head)
// window.firebaseApp, window.db, window.auth, window.storage 在各頁 DOMContentLoaded 後初始化

function initFirebase() {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  window.db      = firebase.firestore();
  window.auth    = firebase.auth();
  window.storage = firebase.storage();
  return { db: window.db, auth: window.auth, storage: window.storage };
}

// ── 共用工具函式 ──────────────────────────────

// Toast 通知
function showToast(msg, type = 'info', duration = 3200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast ${type}`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('show'));
  });
  setTimeout(() => el.classList.remove('show'), duration);
}

// 購物車 (localStorage)
const Cart = {
  key: 'hinoki_cart',
  get() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  save(items) { localStorage.setItem(this.key, JSON.stringify(items)); this.updateBadge(); },
  add(product, qty = 1) {
    const items = this.get();
    const found = items.find(i => i.id === product.id);
    if (found) found.qty += qty;
    else items.push({ ...product, qty });
    this.save(items);
    showToast(`已加入購物車：${product.name}`, 'success');
  },
  remove(id) { const items = this.get().filter(i => i.id !== id); this.save(items); },
  update(id, qty) {
    if (qty <= 0) return this.remove(id);
    const items = this.get();
    const found = items.find(i => i.id === id);
    if (found) found.qty = qty;
    this.save(items);
  },
  clear() { localStorage.removeItem(this.key); this.updateBadge(); },
  total() { return this.get().reduce((s, i) => s + i.price * i.qty, 0); },
  count() { return this.get().reduce((s, i) => s + i.qty, 0); },
  updateBadge() {
    const el = document.getElementById('cart-count');
    if (!el) return;
    const n = this.count();
    el.textContent = n;
    el.classList.toggle('show', n > 0);
  }
};

// 格式化金額
function formatPrice(n) { return `NT$ ${Number(n).toLocaleString('zh-TW')}`; }

// 格式化日期
function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// 產生訂單 ID
function genOrderId() {
  return 'ORD-' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function toTradeNo(orderId) {
  return orderId.replace(/-/g, '');
}

// Active nav link
function setActiveNav() {
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href').split('/').pop();
    a.classList.toggle('active', href === path);
  });
}

// Mobile nav toggle
function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const links  = document.getElementById('nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  Cart.updateBadge();
  setActiveNav();
  initMobileNav();
});
