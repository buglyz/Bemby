import { db } from '../db/database';
import type { EmbywatchConfig, EmbywatchLog } from '../types';

const DEFAULT_UA = 'SenPlayer/6.1.2 CFNetwork/1490.0.4 Darwin/23.2.0';
const PROGRESS_INTERVAL_S = 30;
// Emby uses 100-nanosecond ticks (same as .NET TimeSpan)
const TICKS_PER_SECOND = 10_000_000;

function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function buildAuthHeader(deviceName: string, token?: string): string {
  const parts = [
    'MediaBrowser Client="SenPlayer"',
    `Device="${deviceName}"`,
    `DeviceId="${deviceName}-001"`,
    'Version="6.1.0"',
  ];
  if (token) parts.push(`Token="${token}"`);
  return parts.join(', ');
}

async function embyRequest<T = any>(
  baseUrl: string,
  path: string,
  opts: { method?: string; token?: string; ua: string; deviceName: string; body?: unknown }
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': opts.ua,
      'X-Emby-Authorization': buildAuthHeader(opts.deviceName, opts.token),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Emby ${opts.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : (null as T);
}

export async function runEmbywatch(serverUrl: string, config: EmbywatchConfig): Promise<EmbywatchLog> {
  const ua = config.userAgent ?? getSetting('default_ua') ?? DEFAULT_UA;
  const playDuration = config.playDuration ?? Number(getSetting('default_play_duration') ?? 300);
  const deviceName = getSetting('default_device_name') ?? 'Yamby';

  // 1. Authenticate
  const auth = await embyRequest<any>(serverUrl, '/Users/AuthenticateByName', {
    method: 'POST',
    ua,
    deviceName,
    body: { Username: config.username, Pw: config.password },
  });

  const token: string = auth.AccessToken;
  const userId: string = auth.User.Id;
  console.log(`[embywatch] Authenticated as "${auth.User.Name}" on ${serverUrl}`);

  // 2. Pick a random video (include RunTimeTicks in fields)
  const items = await embyRequest<any>(
    serverUrl,
    `/Users/${userId}/Items?SortBy=Random&Limit=1&IncludeItemTypes=Episode,Movie&Recursive=true&Fields=MediaSources,RunTimeTicks`,
    { ua, token, deviceName }
  );

  if (!items.Items?.length) throw new Error('No playable items found on Emby server');

  const item = items.Items[0];
  const itemId: string = item.Id;
  const mediaSourceId: string = item.MediaSources?.[0]?.Id ?? itemId;
  const playSessionId = `bemby-${Date.now()}`;

  // 3. Calculate start position: random 5-10% into the episode
  const runtimeSeconds = item.RunTimeTicks ? Math.floor(item.RunTimeTicks / TICKS_PER_SECOND) : 0;
  const startPct = 0.05 + Math.random() * 0.05;
  const startSeconds = runtimeSeconds > 0 ? Math.floor(runtimeSeconds * startPct) : 0;
  const startTicks = startSeconds * TICKS_PER_SECOND;

  // 4. Actual watch duration: playDuration + 0-10% random extra
  const actualDuration = Math.floor(playDuration * (1 + Math.random() * 0.10));
  // Cap so we don't overshoot the end of the episode
  const maxWatchable = runtimeSeconds > 0 ? Math.max(0, Math.floor(runtimeSeconds * 0.97) - startSeconds) : Infinity;
  const watchDuration = maxWatchable < Infinity ? Math.min(actualDuration, maxWatchable) : actualDuration;
  const endSeconds = startSeconds + watchDuration;
  const endTicks = endSeconds * TICKS_PER_SECOND;

  console.log(`[embywatch] Watching "${item.Name}" (${item.Type}) from ${startSeconds}s, duration ${watchDuration}s`);

  // 5. Report playback started (from the calculated start position)
  await embyRequest(serverUrl, '/Sessions/Playing', {
    method: 'POST',
    ua,
    token,
    deviceName,
    body: {
      ItemId: itemId,
      MediaSourceId: mediaSourceId,
      PlaySessionId: playSessionId,
      PositionTicks: startTicks,
      IsPaused: false,
      CanSeek: true,
    },
  });

  // 6. Send progress every PROGRESS_INTERVAL_S seconds, offset from start position
  let elapsed = 0;
  while (elapsed < watchDuration) {
    const wait = Math.min(PROGRESS_INTERVAL_S, watchDuration - elapsed);
    await new Promise(r => setTimeout(r, wait * 1000));
    elapsed += wait;

    await embyRequest(serverUrl, '/Sessions/Playing/Progress', {
      method: 'POST',
      ua,
      token,
      deviceName,
      body: {
        ItemId: itemId,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        PositionTicks: startTicks + elapsed * TICKS_PER_SECOND,
        IsPaused: false,
      },
    });
  }

  // 7. Report stopped at the final position
  await embyRequest(serverUrl, '/Sessions/Playing/Stopped', {
    method: 'POST',
    ua,
    token,
    deviceName,
    body: {
      ItemId: itemId,
      MediaSourceId: mediaSourceId,
      PlaySessionId: playSessionId,
      PositionTicks: endTicks,
    },
  });

  // 8. Optionally mark the item as watched (enabled by default)
  let markedWatched = false;
  if (config.markWatched !== false) {
    try {
      await embyRequest(serverUrl, `/Users/${userId}/PlayedItems/${itemId}`, {
        method: 'POST',
        ua,
        token,
        deviceName,
      });
      markedWatched = true;
    } catch (e) {
      console.warn('[embywatch] Failed to mark item as watched:', e);
    }
  }

  console.log(`[embywatch] Session complete for "${item.Name}" — marked watched: ${markedWatched}`);

  return {
    itemType: item.Type ?? 'Unknown',
    title: item.Name ?? 'Unknown',
    seriesName: item.SeriesName,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    runtimeSeconds,
    startSeconds,
    endSeconds,
    watchedSeconds: watchDuration,
    markedWatched,
  };
}
