import nodemailer from "nodemailer";

export function makeTransport(host: string, user: string, pass: string) {
  // FIXED: certificate validation enforced on the SMTP connection.
  return nodemailer.createTransport({
    host,
    port: 587,
    auth: { user, pass },
    tls: { rejectUnauthorized: true },
  });
}
