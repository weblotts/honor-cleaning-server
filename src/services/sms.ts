import twilio from 'twilio';

let client: twilio.Twilio | null = null;

function getClient(): twilio.Twilio | null {
  if (!client && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return client;
}

export async function sendSms(to: string, body: string): Promise<void> {
  const twilioClient = getClient();
  if (!twilioClient) {
    console.warn('[SMS] Twilio not configured, skipping SMS to', to);
    return;
  }

  await twilioClient.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
}

export async function sendBookingReminder(phone: string, date: string, time: string) {
  await sendSms(
    phone,
    `Honor Cleaning: Reminder – your cleaning is scheduled for ${date} at ${time}. Reply STOP to opt out.`,
  );
}
