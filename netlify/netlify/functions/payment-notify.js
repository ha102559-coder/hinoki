// netlify/functions/payment-notify.js
// 接收綠界付款結果通知，驗證後更新 Firebase 訂單狀態

const crypto = require("crypto");

const MERCHANT_ID = "3103095";
const HASH_KEY    = "JUi73W4Zh58OsEqE";
const HASH_IV     = "BjcWioK6rMb3O5Jv";

// ── Firebase Admin SDK（Netlify Functions 可直接用 REST API）──
const FIREBASE_PROJECT = "hinoki-17ffe";

// 產生檢查碼（同 create-payment）
function generateCheckMacValue(params) {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .reduce((acc, key) => { acc[key] = params[key]; return acc; }, {});

  let str = `HashKey=${HASH_KEY}`;
  for (const [k, v] of Object.entries(sorted)) {
    str += `&${k}=${v}`;
  }
  str += `&HashIV=${HASH_IV}`;

  str = encodeURIComponent(str)
    .replace(/%2d/gi, "-")
    .replace(/%5f/gi, "_")
    .replace(/%2e/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2a/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .toLowerCase();

  return crypto.createHash("sha256").update(str).digest("hex").toUpperCase();
}

// 解析 application/x-www-form-urlencoded
function parseForm(body) {
  return Object.fromEntries(
    body.split("&").map(pair => {
      const [k, v] = pair.split("=");
      return [decodeURIComponent(k), decodeURIComponent((v || "").replace(/\+/g, " "))];
    })
  );
}

// 還原綠界的訂單編號（補回 ORD- 前綴）
function restoreOrderId(tradeNo) {
  // MerchantTradeNo 是把 ORD-XXXXXXXX 的 "-" 移除後的結果
  // 例如：ORDXXXXXXXX → ORD-XXXXXXXX
  if (tradeNo.startsWith("ORD")) {
    return tradeNo.replace(/^ORD/, "ORD-");
  }
  return tradeNo;
}

// 更新 Firestore 訂單狀態（使用 REST API，不需安裝 SDK）
async function updateOrderStatus(orderId, status, paymentInfo) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/orders/${orderId}?updateMask.fieldPaths=status&updateMask.fieldPaths=paymentInfo&updateMask.fieldPaths=paidAt`;

  const body = JSON.stringify({
    fields: {
      status:      { stringValue: status },
      paymentInfo: { stringValue: JSON.stringify(paymentInfo) },
      paidAt:      { stringValue: new Date().toISOString() },
    }
  });

  // 注意：Firestore REST 寫入需要 Service Account 憑證
  // 請在 Netlify 環境變數設定 FIREBASE_SERVICE_ACCOUNT_JSON
  // 這裡先用簡化版本，部署後依說明設定即可
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccount) {
    console.warn("⚠️ 尚未設定 FIREBASE_SERVICE_ACCOUNT_JSON，跳過 Firestore 更新");
    return;
  }

  try {
    const { google } = require("googleapis");
    const credentials = JSON.parse(serviceAccount);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/datastore"],
    });
    const token = await auth.getAccessToken();

    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Firestore update failed:", text);
    } else {
      console.log("✅ 訂單狀態已更新：", orderId, "→", status);
    }
  } catch (e) {
    console.error("updateOrderStatus error:", e.message);
  }
}

// ── 主處理 ────────────────────────────────────────────
exports.handler = async (event) => {
  // 綠界用 POST form-data 通知
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = parseForm(event.body || "");
    console.log("綠界通知內容：", JSON.stringify(data));

    // 1. 驗證檢查碼
    const receivedCMV = data.CheckMacValue;
    const paramsForCheck = { ...data };
    delete paramsForCheck.CheckMacValue;
    const expectedCMV = generateCheckMacValue(paramsForCheck);

    if (receivedCMV !== expectedCMV) {
      console.error("CheckMacValue 驗證失敗！");
      return { statusCode: 200, body: "0|CheckMacValue Error" };
    }

    // 2. 確認是否付款成功
    const rtnCode    = data.RtnCode;    // "1" = 成功
    const tradeNo    = data.MerchantTradeNo;
    const orderId    = restoreOrderId(tradeNo);
    const paymentType = data.PaymentType || "";

    if (rtnCode === "1") {
      await updateOrderStatus(orderId, "paid", {
        rtnCode,
        paymentType,
        tradeAmt: data.TradeAmt,
        paymentDate: data.PaymentDate,
        tradeDate: data.TradeDate,
      });
    } else {
      console.log(`付款未成功，RtnCode=${rtnCode}，訂單：${orderId}`);
      await updateOrderStatus(orderId, "payment_failed", { rtnCode });
    }

    // 3. 回傳 "1|OK" 給綠界（必須，否則綠界會重複通知）
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: "1|OK",
    };
  } catch (err) {
    console.error("payment-notify error:", err);
    // 仍回傳 1|OK 避免綠界無限重試
    return { statusCode: 200, body: "1|OK" };
  }
};
