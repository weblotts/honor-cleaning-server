// ────────────────────────────────────────────────────────────────
// Google Calendar & .ics generation utilities
// Generates "Add to Google Calendar" URLs and downloadable .ics files
// for booking appointments.
// ────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  title: string;
  description: string;
  location: string;
  startDate: Date;    // UTC start time
  endDate: Date;      // UTC end time
}

/**
 * Format a Date to Google Calendar's required format: YYYYMMDDTHHmmssZ
 */
function toGoogleDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Format a Date to iCal DTSTART/DTEND format: YYYYMMDDTHHmmssZ
 */
function toIcsDate(date: Date): string {
  return toGoogleDate(date);
}

/**
 * Generate a Google Calendar "Add Event" URL.
 * Users clicking this link will be taken to Google Calendar with
 * the event details pre-filled.
 */
export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    details: event.description,
    location: event.location,
    dates: `${toGoogleDate(event.startDate)}/${toGoogleDate(event.endDate)}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generate a standard iCalendar (.ics) file string.
 * Works with Apple Calendar, Outlook, and any iCal-compatible app.
 */
export function buildIcsContent(event: CalendarEvent): string {
  // Escape special characters per RFC 5545
  const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Honor Cleaning//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${toIcsDate(event.startDate)}`,
    `DTEND:${toIcsDate(event.endDate)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    `LOCATION:${escape(event.location)}`,
    `STATUS:CONFIRMED`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Build calendar event details from booking data.
 * Returns both the Google Calendar URL and .ics content.
 */
export function buildBookingCalendarEvent(booking: {
  serviceType: string;
  scheduledDate: Date | string;
  scheduledTime: string;      // e.g. "09:00"
  durationEstimate: number;   // minutes
  address: { street: string; city: string; state: string; zip: string };
  customerName?: string;
  staffName?: string;
  bookingNumber?: string;
}) {
  // Parse start time
  const dateStr = typeof booking.scheduledDate === 'string'
    ? booking.scheduledDate.split('T')[0]
    : booking.scheduledDate.toISOString().split('T')[0];

  const [hours, minutes] = booking.scheduledTime.split(':').map(Number);
  const startDate = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);

  // Calculate end time
  const endDate = new Date(startDate.getTime() + booking.durationEstimate * 60 * 1000);

  const location = `${booking.address.street}, ${booking.address.city}, ${booking.address.state} ${booking.address.zip}`;

  const descParts = [
    `Service: ${booking.serviceType}`,
    booking.bookingNumber ? `Booking: ${booking.bookingNumber}` : '',
    booking.customerName ? `Customer: ${booking.customerName}` : '',
    booking.staffName ? `Assigned To: ${booking.staffName}` : '',
    `Duration: ${booking.durationEstimate} minutes`,
    '',
    'Honor Cleaning Co.',
    '(508) 333-1838',
  ].filter(Boolean);

  const event: CalendarEvent = {
    title: `Honor Cleaning — ${booking.serviceType.charAt(0).toUpperCase() + booking.serviceType.slice(1)} Clean`,
    description: descParts.join('\n'),
    location,
    startDate,
    endDate,
  };

  return {
    googleCalendarUrl: buildGoogleCalendarUrl(event),
    icsContent: buildIcsContent(event),
    event,
  };
}
