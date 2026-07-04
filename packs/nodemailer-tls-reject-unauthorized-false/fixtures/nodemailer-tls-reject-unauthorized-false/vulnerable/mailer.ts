import nodemailer from "nodemailer";

export function makeTransport(host: string, user: string, pass: string) {
  // VULNERABLE: tls.rejectUnauthorized: false — the SMTP server certificate is not validated.
  return nodemailer.createTransport({
    host,
    port: 587,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}
