// netlify/functions/create-payment.js
// 產生綠界付款表單參數，回傳給前端自動提交

const crypto = require("crypto");

const MERCHANT_ID = "3103095";
const HASH_KEY    = "JUi73W4Zh58OsEqE";
const HASH_IV     = "BjcWioK6rMb3O5Jv";
const ECPAY_URL   = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";

function generateCheckMacValue(params) {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .reduce((acc, key) => { acc[key] = params[key]; return acc; }, {});

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

// 台灣時間 UTC+8
function getTradeDate() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}/${pad(now.getUTCMonth()+1)}/${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { orderId, productName, totalAmount, buyerEmail, siteUrl } = JSON.parse(event.body);

    if (!orderId || !productName || !totalAmount)
      return { statusCode: 400, body: JSON.stringify({ error: "缺少必要參數" }) };

    const params = {
      MerchantID:        MERCHANT_ID,
      MerchantTradeNo:   orderId.replace(/-/g, "").slice(0, 20),
      MerchantTradeDate: getTradeDate(),
      PaymentType:       "aio",
      TotalAmount:       String(Math.round(totalAmount)),
      TradeDesc:         "台灣紅檜精油",        // ✅ 不可 encodeURIComponent，會造成雙重編碼導致簽章失敗
      ItemName:          productName.replace(/[#&=+%]/g, " ").slice(0, 200), // ✅ 移除綠界不接受的字元
      ReturnURL:         `${siteUrl}/.netlify/functions/payment-notify`,
      ClientBackURL:     `${siteUrl}/`,
      ChoosePayment:     "ALL",
      EncryptType:       "1",
      NeedExtraPaidInfo: "N",
    };

    if (buyerEmail && buyerEmail.includes("@")) params.Email = buyerEmail;

    params.CheckMacValue = generateCheckMacValue(params);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ecpayUrl: ECPAY_URL, params }),
    };
  } catch (err) {
    console.error("create-payment error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
