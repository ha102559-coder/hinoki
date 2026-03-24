// netlify/functions/create-payment.js
// 產生綠界付款表單參數，回傳給前端自動提交

const crypto = require("crypto");

// ── 綠界參數 ────────────────────────────────────────────
const MERCHANT_ID = "3103095";
const HASH_KEY    = "JUi73W4Zh58OsEqE";
const HASH_IV     = "BjcWioK6rMb3O5Jv";

// 正式環境付款網址
const ECPAY_URL = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";

// ── 產生檢查碼 ────────────────────────────────────────
function generateCheckMacValue(params) {
  // 1. 按 key 排序
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .reduce((acc, key) => { acc[key] = params[key]; return acc; }, {});

  // 2. 組成字串
  let str = `HashKey=${HASH_KEY}`;
  for (const [k, v] of Object.entries(sorted)) {
    str += `&${k}=${v}`;
  }
  str += `&HashIV=${HASH_IV}`;

  // 3. URL encode（綠界規則）
  str = encodeURIComponent(str)
    .replace(/%2d/gi, "-")
    .replace(/%5f/gi, "_")
    .replace(/%2e/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2a/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .toLowerCase();

  // 4. SHA256
  return crypto.createHash("sha256").update(str).digest("hex").toUpperCase();
}

// ── 日期格式 yyyy/MM/dd HH:mm:ss ────────────────────
function getTradeDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ── 主處理 ────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      orderId,      // ORD-XXXXXXXX
      productName,  // 商品名稱
      totalAmount,  // 總金額（整數）
      buyerEmail,   // 買家 email（可空）
      siteUrl,      // 網站網址（前端傳入）
    } = body;

    if (!orderId || !productName || !totalAmount) {
      return { statusCode: 400, body: JSON.stringify({ error: "缺少必要參數" }) };
    }

    const returnUrl  = `${siteUrl}/.netlify/functions/payment-notify`;
    const clientBack = `${siteUrl}/`;

    const params = {
      MerchantID:        MERCHANT_ID,
      MerchantTradeNo:   orderId.replace(/-/g, "").slice(0, 20), // 最多20碼、不含特殊字元
      MerchantTradeDate: getTradeDate(),
      PaymentType:       "aio",
      TotalAmount:       String(Math.round(totalAmount)),
      TradeDesc:         encodeURIComponent("台灣紅檜精油"),
      ItemName:          productName.slice(0, 200),
      ReturnURL:         returnUrl,
      ClientBackURL:     clientBack,
      ChoosePayment:     "ALL",  // 讓買家自選：信用卡/ATM/超商
      EncryptType:       "1",
      NeedExtraPaidInfo: "N",
    };

    // 加入 Email（選填）
    if (buyerEmail) params.Email = buyerEmail;

    // 產生檢查碼
    params.CheckMacValue = generateCheckMacValue(params);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ecpayUrl: ECPAY_URL,
        params,
      }),
    };
  } catch (err) {
    console.error("create-payment error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
