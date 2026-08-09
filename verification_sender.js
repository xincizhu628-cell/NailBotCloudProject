const fs = require("fs");

function readStdinJson() {
  const raw = fs.readFileSync(0, "utf8");
  return raw ? JSON.parse(raw) : {};
}

function purposeLabel(purpose) {
  return purpose === "reset_password" ? "reset your password" : "create your account";
}

async function sendEmail(payload) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !from) {
    return { sent: false, provider: "nodemailer", reason: "SMTP environment variables are not configured." };
  }
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (error) {
    return { sent: false, provider: "nodemailer", reason: "nodemailer is not installed. Run npm install first." };
  }
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: { user, pass },
  });
  const info = await transporter.sendMail({
    from,
    to: payload.target,
    subject: "AI Nail Studio verification code",
    text: `Your verification code is ${payload.code}. Use it to ${purposeLabel(payload.purpose)}. It expires in 5 minutes.`,
  });
  return { sent: true, provider: "nodemailer", messageId: info.messageId || "" };
}

async function sendSms(payload) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return { sent: false, provider: "twilio", reason: "Twilio environment variables are not configured." };
  }
  let twilio;
  try {
    twilio = require("twilio");
  } catch (error) {
    return { sent: false, provider: "twilio", reason: "twilio is not installed. Run npm install first." };
  }
  const client = twilio(sid, token);
  const message = await client.messages.create({
    from,
    to: payload.target,
    body: `AI Nail Studio verification code: ${payload.code}. It expires in 5 minutes.`,
  });
  return { sent: true, provider: "twilio", sid: message.sid || "" };
}

async function main() {
  const payload = readStdinJson();
  const result = payload.targetType === "email"
    ? await sendEmail(payload)
    : await sendSms(payload);
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    sent: false,
    provider: "verification-sender",
    reason: error.message || "Failed to send verification code.",
  }));
  process.exitCode = 1;
});
