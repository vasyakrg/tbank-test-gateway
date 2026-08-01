const payments = new Map();
const webhookLog = [];
let nextId = 2460000000;

function createPayment(data) {
  const paymentId = nextId++;
  const payment = {
    paymentId,
    orderId: data.OrderId,
    amount: data.Amount,
    description: data.Description || "",
    terminalKey: data.TerminalKey,
    successURL: data.SuccessURL || "",
    failURL: data.FailURL || "",
    notificationURL: data.NotificationURL || "",
    status: "NEW",
    refundedAmount: 0,
    requestPayload: data,
    webhooks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  payments.set(String(paymentId), payment);
  return payment;
}

function getPayment(paymentId) {
  return payments.get(String(paymentId)) || null;
}

function updateStatus(paymentId, status) {
  const payment = payments.get(String(paymentId));
  if (!payment) return null;
  payment.status = status;
  payment.updatedAt = new Date();
  return payment;
}

function refundPayment(paymentId, amount) {
  const payment = payments.get(String(paymentId));
  if (!payment) return null;
  payment.refundedAmount += amount;
  payment.status = payment.refundedAmount >= payment.amount ? "REFUNDED" : "PARTIAL_REFUNDED";
  payment.updatedAt = new Date();
  return payment;
}

function logWebhook(paymentId, payload, responseStatus, responseBody) {
  const entry = {
    paymentId,
    payload,
    responseStatus,
    responseBody,
    sentAt: new Date(),
  };
  webhookLog.push(entry);
  const payment = payments.get(String(paymentId));
  if (payment) {
    payment.webhooks.push(entry);
  }
  return entry;
}

function getAllPayments() {
  return Array.from(payments.values()).reverse();
}

function getWebhookLog() {
  return [...webhookLog].reverse();
}

module.exports = { createPayment, getPayment, updateStatus, refundPayment, logWebhook, getAllPayments, getWebhookLog };
