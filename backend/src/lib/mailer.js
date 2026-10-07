// Transactional email via Resend (HTTP API, no SDK).
// If RESEND_API_KEY is unset (local dev), the email content is logged
// to the console instead so flows remain testable without a provider.
export async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'MPCS <no-reply@mpcs.com>';

  if (!key) {
    console.log('📧 [dev mailer] ─────────────────────');
    console.log(`To: ${to}\nSubject: ${subject}\n\n${html.replace(/<[^>]+>/g, '')}`);
    console.log('──────────────────────────────────────');
    return { dev: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Email send failed (${res.status})`);
  return data;
}

export const appUrl = () => process.env.APP_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:5173';
