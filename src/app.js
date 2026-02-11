const express = require("express");
const path = require("path");
const { generateToken, verifyToken } = require("./token");
const storage = require("./storage");

const app = express();
const PORT = process.env.PORT || 3000;
const TERMINAL_KEY = process.env.TERMINAL_KEY || "TBankGatewayEmulatorLocal";
const PASSWORD = process.env.PASSWORD || "emulator_secret_password";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- TBank API Endpoints ---

// POST /v2/Init — Create payment
app.post("/v2/Init", (req, res) => {
  const params = req.body;

  console.log("[Init] Request:", { OrderId: params.OrderId, Amount: params.Amount, TerminalKey: params.TerminalKey });

  if (params.TerminalKey !== TERMINAL_KEY) {
    return res.json({
      Success: false,
      ErrorCode: "7",
      Message: "Invalid TerminalKey",
    });
  }

  if (!verifyToken(params, PASSWORD)) {
    return res.json({
      Success: false,
      ErrorCode: "9",
      Message: "Invalid Token",
    });
  }

  const payment = storage.createPayment(params);
  const paymentURL = `${BASE_URL}/payment/${payment.paymentId}`;

  const response = {
    Success: true,
    ErrorCode: "0",
    TerminalKey: TERMINAL_KEY,
    Status: "NEW",
    PaymentId: String(payment.paymentId),
    OrderId: params.OrderId,
    Amount: params.Amount,
    PaymentURL: paymentURL,
  };

  console.log("[Init] Created payment:", {
    PaymentId: payment.paymentId,
    OrderId: params.OrderId,
    PaymentURL: paymentURL,
  });

  res.json(response);
});

// POST /v2/GetState — Check payment status
app.post("/v2/GetState", (req, res) => {
  const params = req.body;

  console.log("[GetState] Request:", { PaymentId: params.PaymentId });

  if (params.TerminalKey !== TERMINAL_KEY) {
    return res.json({
      Success: false,
      ErrorCode: "7",
      Message: "Invalid TerminalKey",
    });
  }

  if (!verifyToken(params, PASSWORD)) {
    return res.json({
      Success: false,
      ErrorCode: "9",
      Message: "Invalid Token",
    });
  }

  const payment = storage.getPayment(params.PaymentId);
  if (!payment) {
    return res.json({
      Success: false,
      ErrorCode: "6",
      Message: "Payment not found",
    });
  }

  const response = {
    Success: true,
    ErrorCode: "0",
    TerminalKey: TERMINAL_KEY,
    Status: payment.status,
    PaymentId: String(payment.paymentId),
    OrderId: payment.orderId,
    Amount: payment.amount,
  };

  console.log("[GetState] Response:", { PaymentId: payment.paymentId, Status: payment.status });

  res.json(response);
});

// POST /v2/Cancel — Refund payment
app.post("/v2/Cancel", async (req, res) => {
  const params = req.body;

  console.log("[Cancel] Request:", { PaymentId: params.PaymentId });

  if (params.TerminalKey !== TERMINAL_KEY) {
    return res.json({
      Success: false,
      ErrorCode: "7",
      Message: "Invalid TerminalKey",
    });
  }

  if (!verifyToken(params, PASSWORD)) {
    return res.json({
      Success: false,
      ErrorCode: "9",
      Message: "Invalid Token",
    });
  }

  const payment = storage.getPayment(params.PaymentId);
  if (!payment) {
    return res.json({
      Success: false,
      ErrorCode: "6",
      Message: "Payment not found",
    });
  }

  if (payment.status !== "CONFIRMED") {
    return res.json({
      Success: false,
      ErrorCode: "15",
      Message: `Cannot cancel payment in status ${payment.status}`,
    });
  }

  storage.updateStatus(params.PaymentId, "REFUNDED");

  const response = {
    Success: true,
    ErrorCode: "0",
    TerminalKey: TERMINAL_KEY,
    Status: "REFUNDED",
    PaymentId: String(payment.paymentId),
    OrderId: payment.orderId,
    OriginalAmount: payment.amount,
    Amount: payment.amount,
  };

  console.log("[Cancel] Payment refunded:", { PaymentId: payment.paymentId });

  // Send webhook asynchronously
  sendWebhook(payment, "REFUNDED").catch((err) => {
    console.error("[Cancel] Webhook failed:", err.message);
  });

  res.json(response);
});

// --- Payment Page ---

// GET /payment/:paymentId — Payment form
app.get("/payment/:paymentId", (req, res) => {
  const payment = storage.getPayment(req.params.paymentId);

  if (!payment) {
    return res.status(404).send("Payment not found");
  }

  if (payment.status !== "NEW") {
    return res.status(400).send(`Payment already processed (status: ${payment.status})`);
  }

  res.render("payment", {
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    amount: payment.amount,
    description: payment.description,
    baseUrl: BASE_URL,
  });
});

// POST /payment/:paymentId/complete — Process payment action
app.post("/payment/:paymentId/complete", async (req, res) => {
  const payment = storage.getPayment(req.params.paymentId);
  const { action } = req.body;

  if (!payment) {
    return res.status(404).send("Payment not found");
  }

  if (payment.status !== "NEW") {
    return res.status(400).send(`Payment already processed (status: ${payment.status})`);
  }

  if (action === "approve") {
    storage.updateStatus(String(payment.paymentId), "CONFIRMED");
    console.log("[Payment] Approved:", { PaymentId: payment.paymentId, OrderId: payment.orderId });

    // Send webhook
    try {
      await sendWebhook(payment, "CONFIRMED");
      console.log("[Payment] Webhook sent: CONFIRMED");
    } catch (err) {
      console.error("[Payment] Webhook failed:", err.message);
    }

    return res.redirect(payment.successURL);
  }

  if (action === "reject") {
    storage.updateStatus(String(payment.paymentId), "REJECTED");
    console.log("[Payment] Rejected:", { PaymentId: payment.paymentId, OrderId: payment.orderId });

    // Send webhook
    try {
      await sendWebhook(payment, "REJECTED");
      console.log("[Payment] Webhook sent: REJECTED");
    } catch (err) {
      console.error("[Payment] Webhook failed:", err.message);
    }

    return res.redirect(payment.failURL);
  }

  res.status(400).send("Invalid action");
});

// --- Webhook ---

async function sendWebhook(payment, status) {
  if (!payment.notificationURL) {
    console.log("[Webhook] No NotificationURL, skipping");
    return;
  }

  const payload = {
    TerminalKey: payment.terminalKey,
    OrderId: payment.orderId,
    Success: status === "CONFIRMED",
    Status: status,
    PaymentId: String(payment.paymentId),
    ErrorCode: "0",
    Amount: payment.amount,
    Pan: "430000******0777",
    ExpDate: "1228",
    CardId: "123456",
  };

  payload.Token = generateToken(payload, PASSWORD);

  console.log("[Webhook] Sending to", payment.notificationURL, { Status: status, OrderId: payment.orderId });

  try {
    const response = await fetch(payment.notificationURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    console.log("[Webhook] Response:", response.status, text);
    storage.logWebhook(payment.paymentId, payload, response.status, text);
  } catch (err) {
    console.error("[Webhook] Error:", err.message);
    storage.logWebhook(payment.paymentId, payload, 0, err.message);
    throw err;
  }
}

// --- Payment Log ---

// JSON API for payments data
app.get("/api/payments", (req, res) => {
  const payments = storage.getAllPayments().map((p) => ({
    paymentId: p.paymentId,
    orderId: p.orderId,
    amount: p.amount,
    description: p.description,
    status: p.status,
    notificationURL: p.notificationURL,
    requestPayload: p.requestPayload,
    webhooks: p.webhooks,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
  res.json({ payments, total: payments.length });
});

// HTML log page
app.get("/log", (req, res) => {
  res.render("log");
});

// --- Health check ---

app.get("/health", (req, res) => {
  res.json({ status: "ok", payments: storage.getAllPayments().length });
});

// --- Start ---

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TBank Gateway Emulator running on port ${PORT}`);
  console.log(`  TerminalKey: ${TERMINAL_KEY}`);
  console.log(`  BASE_URL: ${BASE_URL}`);
});
