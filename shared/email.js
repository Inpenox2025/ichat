const nodemailer = require('nodemailer');

function getTransporter() {
  const host = process.env.EMAIL_HOST;
  const port = process.env.EMAIL_PORT || 587;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (user && pass) {
    return nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465, // true for 465, false for other ports
      auth: { user, pass }
    });
  }
  return null;
}

async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();
  const from = process.env.EMAIL_FROM || '"ichat Secure" <noreply@example.com>';

  if (transporter) {
    try {
      await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html
      });
      console.log(`[EMAIL] Mail sent successfully to ${to}`);
      return true;
    } catch (error) {
      console.error('[EMAIL] Failed to send email:', error);
      // Fallback to console log on error
    }
  }

  // Console fallback if SMTP is not configured or fails
  console.log('\n==================================================');
  console.log(`[EMAIL SIMULATOR] Outgoing Mail`);
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Content:\n${text}`);
  console.log('==================================================\n');
  return true;
}

module.exports = { sendMail };
