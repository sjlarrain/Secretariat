import { google } from 'googleapis';
import { ConnectedAccount, saveAccount, encryptTokens, decryptTokens } from '../token-store';
import { GoogleTokens, getAuthenticatedClient } from './oauth';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  calendarAlias?: string;
}

async function getCalendarClient(account: ConnectedAccount) {
  const tokens = decryptTokens<GoogleTokens>(account.encryptedTokens);
  const { client, refreshedTokens } = await getAuthenticatedClient(tokens);

  if (refreshedTokens?.access_token) {
    account.encryptedTokens = encryptTokens({
      access_token: refreshedTokens.access_token,
      refresh_token: refreshedTokens.refresh_token ?? tokens.refresh_token,
      expiry_date: refreshedTokens.expiry_date ?? tokens.expiry_date,
    });
    await saveAccount(account);
  }

  return google.calendar({ version: 'v3', auth: client });
}

export async function createEvent(
  account: ConnectedAccount,
  params: {
    title: string;
    startDatetime: Date;
    endDatetime: Date;
    attendees: string[];
    notes?: string;
    timezone: string;
  }
): Promise<{ eventId: string; htmlLink: string }> {
  const cal = await getCalendarClient(account);

  const event = await cal.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: params.title,
      description: params.notes,
      start: { dateTime: params.startDatetime.toISOString(), timeZone: params.timezone },
      end: { dateTime: params.endDatetime.toISOString(), timeZone: params.timezone },
      attendees: params.attendees.map((email) => ({ email })),
    },
  });

  return {
    eventId: event.data.id ?? '',
    htmlLink: event.data.htmlLink ?? '',
  };
}

export async function getEventsForDate(account: ConnectedAccount, date: Date, timezone: string): Promise<CalendarEvent[]> {
  const cal = await getCalendarClient(account);

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: timezone,
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? '',
    title: e.summary ?? '(no title)',
    start: new Date(e.start?.dateTime ?? e.start?.date ?? ''),
    end: new Date(e.end?.dateTime ?? e.end?.date ?? ''),
    calendarAlias: account.alias,
  }));
}

export async function getTodayEvents(account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]> {
  return getEventsForDate(account, new Date(), timezone);
}

export async function getWeekEvents(account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]> {
  const cal = await getCalendarClient(account);

  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: weekLater.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: timezone,
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? '',
    title: e.summary ?? '(no title)',
    start: new Date(e.start?.dateTime ?? e.start?.date ?? ''),
    end: new Date(e.end?.dateTime ?? e.end?.date ?? ''),
    calendarAlias: account.alias,
  }));
}
