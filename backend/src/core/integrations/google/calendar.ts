import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { ConnectedAccount, saveAccount, encryptTokens, decryptTokens } from '../token-store';
import { GoogleTokens, getAuthenticatedClient, CalendarDisconnectedError } from './oauth';
import { startOfDayInZone, endOfDayInZone } from '../../../shared/utils/date';

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

async function getCalendarClient(userId: string, account: ConnectedAccount) {
  let tokens: GoogleTokens;
  try {
    tokens = decryptTokens<GoogleTokens>(account.encryptedTokens, account.id);
  } catch {
    await saveAccount(userId, { ...account, isDisconnected: true });
    throw new CalendarDisconnectedError(account.alias);
  }

  try {
    const { client, refreshedTokens } = await getAuthenticatedClient(tokens, account.alias);

    if (refreshedTokens?.access_token) {
      account.encryptedTokens = encryptTokens({
        access_token: refreshedTokens.access_token,
        refresh_token: refreshedTokens.refresh_token ?? tokens.refresh_token,
        expiry_date: refreshedTokens.expiry_date ?? tokens.expiry_date,
      }, account.id);
      await saveAccount(userId, account);
    }

    return google.calendar({ version: 'v3', auth: client });
  } catch (err) {
    if (err instanceof CalendarDisconnectedError) {
      await saveAccount(userId, { ...account, isDisconnected: true });
    }
    throw err;
  }
}

export async function listCalendars(userId: string, account: ConnectedAccount): Promise<GoogleCalendar[]> {
  const cal = await getCalendarClient(userId, account);
  const res = await cal.calendarList.list();
  return (res.data.items ?? []).map((item) => ({
    id: item.id ?? '',
    summary: item.summary ?? '',
    primary: !!item.primary,
    backgroundColor: item.backgroundColor ?? undefined,
  }));
}

export async function createEvent(
  userId: string,
  account: ConnectedAccount,
  params: {
    title: string;
    attendees: string[];
    notes?: string;
    timezone: string;
    withMeetLink?: boolean;
  } & (
    | { allDay: true; startDate: string; endDate: string }
    | { allDay?: false; startDatetime: Date; endDatetime: Date }
  )
): Promise<{ eventId: string; htmlLink: string; meetLink?: string }> {
  const cal = await getCalendarClient(userId, account);

  const event = await cal.events.insert({
    calendarId: 'primary',
    // conferenceDataVersion must be 1 for Google to honour createRequest.
    ...(params.withMeetLink ? { conferenceDataVersion: 1 } : {}),
    requestBody: {
      summary: params.title,
      description: params.notes,
      start: params.allDay
        ? { date: params.startDate }
        : { dateTime: params.startDatetime.toISOString(), timeZone: params.timezone },
      end: params.allDay
        ? { date: params.endDate }
        : { dateTime: params.endDatetime.toISOString(), timeZone: params.timezone },
      attendees: params.attendees.map((email) => ({ email })),
      ...(params.withMeetLink
        ? {
            conferenceData: {
              createRequest: {
                // Must be unique per request; Google echoes it back to
                // deduplicate retries of the same conference creation.
                requestId: randomUUID(),
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }
        : {}),
    },
  });

  const meetLink =
    event.data.hangoutLink ??
    event.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
    undefined;

  return {
    eventId: event.data.id ?? '',
    htmlLink: event.data.htmlLink ?? '',
    meetLink: meetLink ?? undefined,
  };
}

export async function getEventsForDate(userId: string, account: ConnectedAccount, date: Date, timezone: string): Promise<CalendarEvent[]> {
  const cal = await getCalendarClient(userId, account);

  const startOfDay = startOfDayInZone(date, timezone);
  const endOfDay = endOfDayInZone(date, timezone);

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

export async function getTodayEvents(userId: string, account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]> {
  return getEventsForDate(userId, account, new Date(), timezone);
}

export async function getWeekEvents(userId: string, account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]> {
  const cal = await getCalendarClient(userId, account);

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
