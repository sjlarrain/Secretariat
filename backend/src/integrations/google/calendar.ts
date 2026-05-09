import { google } from 'googleapis';
import { ConnectedAccount, saveAccount, encryptTokens, decryptTokens } from '../token-store';
import { GoogleTokens, getAuthenticatedClient } from './oauth';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  calendarAlias?: string;
  isAllDay: boolean;
}

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor?: string;
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

export async function listCalendars(account: ConnectedAccount): Promise<GoogleCalendar[]> {
  const cal = await getCalendarClient(account);
  const res = await cal.calendarList.list();
  return (res.data.items ?? []).map((item) => ({
    id: item.id ?? '',
    summary: item.summary ?? '',
    primary: !!item.primary,
    backgroundColor: item.backgroundColor ?? undefined,
  }));
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

  const calendarIds = account.enabledCalendarIds ?? ['primary'];
  const results = await Promise.all(
    calendarIds.map((calendarId) =>
      cal.events.list({
        calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: timezone,
      })
    )
  );

  const seen = new Set<string>();
  return results.flatMap((res, i) =>
    (res.data.items ?? [])
      .filter((e) => {
        const title = e.summary ?? '';
        if (/^canceled[:\s]/i.test(title)) return false;
        const start = e.start?.dateTime ?? e.start?.date ?? '';
        const key = `${title}|${start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((e) => ({
        id: e.id ?? '',
        title: e.summary ?? '(no title)',
        start: new Date(e.start?.dateTime ?? e.start?.date ?? ''),
        end: new Date(e.end?.dateTime ?? e.end?.date ?? ''),
        calendarAlias: account.calendarNames?.[calendarIds[i]] ?? account.alias,
        isAllDay: !e.start?.dateTime,
      }))
  );
}

export async function getTodayEvents(account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]> {
  return getEventsForDate(account, new Date(), timezone);
}

export async function getWeekEvents(account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]> {
  const cal = await getCalendarClient(account);

  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const calendarIds = account.enabledCalendarIds ?? ['primary'];
  const results = await Promise.all(
    calendarIds.map((calendarId) =>
      cal.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: weekLater.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: timezone,
      })
    )
  );

  const seen = new Set<string>();
  return results.flatMap((res, i) =>
    (res.data.items ?? [])
      .filter((e) => {
        const title = e.summary ?? '';
        if (/^canceled[:\s]/i.test(title)) return false;
        const start = e.start?.dateTime ?? e.start?.date ?? '';
        const key = `${title}|${start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((e) => ({
        id: e.id ?? '',
        title: e.summary ?? '(no title)',
        start: new Date(e.start?.dateTime ?? e.start?.date ?? ''),
        end: new Date(e.end?.dateTime ?? e.end?.date ?? ''),
        calendarAlias: account.calendarNames?.[calendarIds[i]] ?? account.alias,
        isAllDay: !e.start?.dateTime,
      }))
  );
}
