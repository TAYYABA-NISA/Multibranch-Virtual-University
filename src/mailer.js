import nodemailer from 'nodemailer';

// Sends email through SMTP (Mailtrap, Gmail app password, ...). With no SMTP settings,
// the email is printed in the terminal instead and kept in `outbox`, so you can develop without a mail account.
export const outbox = [];
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

export async function sendMail({ to, subject, text }) {
  if (!transport) {
    outbox.push({ to, subject, text });
    console.log(`\n[email not sent: SMTP is not set] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || 'ExamSlot <no-reply@examslot.test>', to, subject, text });
}
