// netlify/functions/payment-notify.js
// 接收綠界付款結果 → 驗證簽章 → 更新 Firebase 訂單狀態
// 只使用 Node.js 內建模組，不需要額外安裝套件

const crypto = require("crypto");
const https  = require("https");

const HASH_KEY         = process.env.ECPAY_HASH_KEY;
const HASH_IV          = process.env.ECPAY_HASH_IV;
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;

// ── 1. 驗證綠界 CheckMacValue ────────────────────────
function generateCMV(params) {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .reduce((acc, k) => { acc[k] = params[k]; return acc; }, {});

  let str = `HashKey=${HASH_KEY}`;
  for (const [k, v] of Object.entries(sorted)) str += `&${k}=${v}`;
  str += `&HashIV=${HASH_IV}`;

  str = encodeURIComponent(str)
    .replace(/%2d/gi, "-").replace(/%5f/gi, "_").replace(/%2e/gi, ".")
    .replace(/%21/gi, "!").replace(/%2a/gi, "*")
    .replace(/%28/gi, "(").replace(/%29/gi, ")")
    .toLowerCase();

  return crypto.createHash("sha256").update(str).digest("hex").toUpperCase();
}

// ── 2. 解析 application/x-www-form-urlencoded ────────
function parseForm(body) {
  return Object.fromEntries(
    body.split("&").map(p => {
      const idx = p.indexOf("=");
      const k = p.slice(0, idx);
      const v = p.slice(idx + 1);
      return [
        decodeURIComponent(k),
        decodeURIComponent(v.replace(/\+/g, " "))
      ];
    })
  );
}

// ── 3. 還原訂單編號（補回 ORD- 的破折號）───────────
function restoreOrderId(tradeNo) {
  // 存入時 ORD-12345678 → 移除 - 變成 ORD12345678
  // 還原時 ORD12345678 → ORD-12345678
  if (tradeNo.startsWith("ORD") && !tradeNo.includes("-")) {
    return "ORD-" + tradeNo.slice(3);
  }
  return tradeNo;
}

// ── 4. 用 Service Account 私鑰產生 Google Access Token
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss:   sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  };

  const hdr     = Buffer.from(JSON.stringify({ alg:"RS256", typ:"JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const signing = `${hdr}.${payload}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signing);
  const sig = signer.sign(sa.private_key, "base64url");
  const jwt = `${signing}.${sig}`;

  const formBody = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const raw = await httpsReq({
    hostname: "oauth2.googleapis.com",
    path:     "/token",
    method:   "POST",
    headers: {
      "Content-Type":   "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(formBody),
    },
  }, formBody);

  const json = JSON.parse(raw);
  if (!json.access_token) throw new Error("Access Token 失敗: " + raw.slice(0,300));
  return json.access_token;
}

// ── 5. 用 PATCH 更新 Firestore 訂單文件 ─────────────
async function updateFirestoreOrder(orderId, status, payInfo, token) {
  const path =
    `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/orders/${orderId}` +
    `?updateMask.fieldPaths=status` +
    `&updateMask.fieldPaths=paidAt` +
    `&updateMask.fieldPaths=paymentInfo`;

  const body = JSON.stringify({
    fields: {
      status:      { stringValue: status },
      paidAt:      { stringValue: new Date().toISOString() },
      paymentInfo: { stringValue: JSON.stringify(payInfo) },
    }
  });

  const result = await httpsReq({
    hostname: "firestore.googleapis.com",
    path,
    method:  "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  }, body);

  console.log("Firestore PATCH 回應：", result.slice(0, 200));
}

// ── 通用 HTTPS 請求 ──────────────────────────────────
function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const req = https.request(options, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

// ── 主入口 ───────────────────────────────────────────
exports.handler = async (event) => {
  // 綠界只發 POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = parseForm(event.body || "");
    console.log("綠界通知原始資料：", JSON.stringify(data));

    // ① 驗證 CheckMacValue，防止偽造
    const received = data.CheckMacValue;
    const forCheck = { ...data };
    delete forCheck.CheckMacValue;

    if (!received || received !== generateCMV(forCheck)) {
      console.error("❌ CheckMacValue 驗證失敗！received:", received);
      return { statusCode: 200, body: "0|CheckMacValue Error" };
    }

    // ② 解析關鍵欄位
    const orderId = restoreOrderId(data.MerchantTradeNo || "");
    const success = data.RtnCode === "1";
    const newStatus = success ? "paid" : "payment_failed";

    const payInfo = {
      rtnCode:     data.RtnCode,
      rtnMsg:      data.RtnMsg,
      paymentType: data.PaymentType,
      tradeAmt:    data.TradeAmt,
      paymentDate: data.PaymentDate,
      tradeDate:   data.TradeDate,
      tradeNo:     data.TradeNo,
    };

    console.log(`訂單 ${orderId} → ${newStatus}`);

    // ③ 更新 Firebase（需要環境變數 FIREBASE_SERVICE_ACCOUNT_JSON）
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (saJson) {
      const sa    = JSON.parse(saJson);
      const token = await getAccessToken(sa);
      await updateFirestoreOrder(orderId, newStatus, payInfo, token);
      console.log(`✅ Firebase 訂單 ${orderId} 已更新為 ${newStatus}`);
    } else {
      // 尚未設定環境變數時，印出警告但不讓 Function 失敗
      console.warn("⚠️ 未設定 FIREBASE_SERVICE_ACCOUNT_JSON，略過 Firebase 更新");
    }

    // ④ 必須回傳 1|OK，否則綠界會持續重試通知
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: "1|OK",
    };

  } catch (err) {
    console.error("payment-notify 錯誤：", err.message, err.stack);
    // 即使出錯也回 1|OK，避免綠界無限重試
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: "1|OK",
    };
  }
};
