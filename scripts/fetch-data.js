#!/usr/bin/env node
'use strict';

/**
 * Fetches live Diablo IV event data and writes data/helltide.json.
 *
 * Run it directly to check output without committing:
 *   node scripts/fetch-data.js --dry-run
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const FEEDS = {
  helltide: 'https://helltides-7e530-r1.firebaseio.com/helltide.json',
  world_boss: 'https://helltides-7e530-r1.firebaseio.com/world_boss.json',
  legion: 'https://helltides-7e530-r1.firebaseio.com/legion.json',
};

// Event cadences in minutes. The feeds only expose the current window plus a
// single `nextTime`, so anything further out is projected from these. Each one
// is confirmed against the feeds' own `nextTime` and against archived schedule
// data captured five months earlier.
const CADENCE = {
  helltide: 60, // hourly, on the hour
  legion: 25,
  world_boss: 210, // 3.5 hours
};

// How far past an event's start it still counts as "upcoming", in minutes.
// A boss stays listed for a while after spawning; a helltide does not.
const GRACE = { helltide: 0, legion: 5, world_boss: 15 };

const OUT = path.join(__dirname, '..', 'data', 'helltide.json');
const TIMEOUT_MS = 15000;

// Mystery chest locations per zone, selected by helltide index.
const CHESTS = {
  fractured_peaks: [
    ['Western Ways', 'Kor Rohavan'],
    ['Western Ways (East)', 'Olyam Tundra'],
  ],
  scosglen: [
    ['Fothrach Castle', 'The Dead Barks'],
    ['Abandoned Coast', 'Tur Dulra'],
    ['Westering Lowlands', 'Wailing Hills'],
    ['Cursed Scarps', 'Túr Dúlra North'],
  ],
  dry_steppes: [
    ["Wayfarer's Folly", "Desolation's Reach"],
    ['Crucible of Cinder', 'Galtmaa Bushland'],
  ],
  hawezar: [
    ["Pilgrim's Cave", 'Plains of Attrition'],
    ["Intruder's Claim", 'Devouring Moon'],
  ],
  kehjistan: [
    ['Scorching Dunes (NW)', 'Forgotten Coastline', 'Amber Sands'],
    ['Forgotten Coastline (S)', 'Amber Sands', 'Scorching Dunes (E)'],
    ['Scorching Dunes (SW)', 'Amber Sands', 'Forgotten Coastline'],
  ],
  nahantu: [
    ['Roots of Hatred (W)', 'Faithless Sanctum'],
    ['Viper Gorge', 'Jagged Ravine'],
  ],
};

function getChests(zone, helltideId) {
  const lookup = CHESTS[zone];
  if (!lookup) return [];
  const idx = Math.floor(helltideId / 3600);
  const mod = zone === 'scosglen' ? 4 : zone === 'kehjistan' ? 3 : 2;
  return lookup[idx % mod] || lookup[0];
}

function snippet(body) {
  return String(body).replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * GET a URL and parse it as JSON.
 *
 * Status and content-type are checked before parsing so an HTML error page --
 * a Cloudflare challenge, say -- reports as the HTTP failure it is rather than
 * surfacing as a confusing "unexpected token <" parse error.
 */
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'd4-life/1.0 (+https://github.com/jawsomejason/d4-life)',
        },
      },
      res => {
        const status = res.statusCode;
        const ctype = res.headers['content-type'] || '';
        let body = '';
        res.setEncoding('utf8');
        res.on('data', d => (body += d));
        res.on('end', () => {
          if (status < 200 || status >= 300) {
            return reject(new Error(`HTTP ${status} from ${url} — ${snippet(body)}`));
          }
          if (!/json/i.test(ctype)) {
            return reject(
              new Error(`expected JSON from ${url}, got ${ctype || 'no content-type'} — ${snippet(body)}`)
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`malformed JSON from ${url} — ${snippet(body)}`));
          }
        });
      }
    );
    req.on('error', e => reject(new Error(`request to ${url} failed: ${e.message}`)));
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`request to ${url} timed out after ${TIMEOUT_MS}ms`));
    });
  });
}

/**
 * Project the next `count` occurrences of a fixed-cadence event.
 *
 * Occurrences sit on the lattice anchored at `anchorIso`, and the first one
 * returned is the earliest at or after `now - graceMin`. Anchoring to a lattice
 * rather than counting forward from now means a stale anchor still yields
 * correct times, which is what lets a carried-forward feed value stay useful.
 */
function project(anchorIso, periodMin, count, graceMin, now) {
  const anchor = Date.parse(anchorIso);
  if (!Number.isFinite(anchor)) return [];
  const period = periodMin * 60000;
  const cutoff = now - graceMin * 60000;
  const first = anchor + Math.ceil((cutoff - anchor) / period) * period;
  return Array.from({ length: count }, (_, i) => new Date(first + i * period).toISOString());
}

function buildUpcoming({ helltide, world_boss: worldBoss, legion }, now) {
  const upcoming = { world_boss: [], helltide: [], legion: [] };

  if (helltide && helltide.startTime) {
    upcoming.helltide = project(helltide.startTime, CADENCE.helltide, 3, GRACE.helltide, now).map(
      startTime => ({ startTime })
    );
  }

  if (legion && legion.startTime) {
    upcoming.legion = project(legion.startTime, CADENCE.legion, 3, GRACE.legion, now).map(
      startTime => ({ startTime })
    );
  }

  if (worldBoss && worldBoss.startTime) {
    // The feed names the boss and its zones for the current window only, so the
    // first projected occurrence keeps that detail and later ones carry a time
    // alone. Better a bare time than an invented boss name.
    const named = new Date(worldBoss.startTime).toISOString();
    upcoming.world_boss = project(
      worldBoss.startTime,
      CADENCE.world_boss,
      3,
      GRACE.world_boss,
      now
    ).map(startTime =>
      startTime === named
        ? { startTime, boss: worldBoss.boss, zone: worldBoss.zone }
        : { startTime }
    );
  }

  return upcoming;
}

function readPrevious() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const names = Object.keys(FEEDS);
  const settled = await Promise.allSettled(names.map(n => getJson(FEEDS[n])));

  const fetched = {};
  const failures = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') fetched[names[i]] = r.value;
    else failures.push(`${names[i]} — ${r.reason.message}`);
  });

  failures.forEach(f => console.error(`WARN  ${f}`));

  // Every feed is independent, so one being down must not discard the others.
  // Bail only when nothing at all came back, rather than writing a file of nulls.
  if (!Object.keys(fetched).length) {
    throw new Error(`all ${names.length} feeds failed; leaving existing data untouched`);
  }

  // Carry forward the last known value for any feed that failed. The projection
  // lattice keeps working off a stale anchor, and fetchedAt still shows the age.
  const previous = readPrevious();
  const data = {
    helltide: fetched.helltide || previous.helltide || null,
    world_boss: fetched.world_boss || previous.world_boss || null,
    legion: fetched.legion || previous.legion || null,
  };

  if (data.helltide && data.helltide.zone && data.helltide.id) {
    data.helltide.chests = getChests(data.helltide.zone, data.helltide.id);
  }

  const now = Date.now();
  const output = {
    ...data,
    upcoming: buildUpcoming(data, now),
    fetchedAt: new Date(now).toISOString(),
  };
  if (failures.length) output.degraded = failures;

  // fetchedAt moves on every run, so writing it unconditionally produces a commit
  // every five minutes even when no event data changed. Hold the previous value
  // when nothing else moved: the file stays byte-identical and the commit step
  // finds nothing to do. In the repo fetchedAt then reads as "when the data last
  // changed", which is the better staleness signal anyway, since events roll at
  // least every 25 minutes and a timestamp older than that means something broke.
  const withoutTimestamp = o => JSON.stringify({ ...o, fetchedAt: undefined });
  const unchanged =
    Boolean(previous.fetchedAt) && withoutTimestamp(output) === withoutTimestamp(previous);
  if (unchanged) output.fetchedAt = previous.fetchedAt;

  const json = JSON.stringify(output, null, 2);
  if (dryRun) {
    console.log(json);
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json);
  }

  const h = output.helltide;
  const nextBoss = output.upcoming.world_boss[0];
  console.log(`Helltide: ${h && h.zone} | Chests: ${h && h.chests ? h.chests.join(', ') : 'n/a'}`);
  console.log(`Next boss: ${(nextBoss && nextBoss.boss) || 'unknown'} at ${nextBoss && nextBoss.startTime}`);
  console.log(
    `Upcoming: ${output.upcoming.helltide.length} helltide, ` +
      `${output.upcoming.world_boss.length} boss, ${output.upcoming.legion.length} legion` +
      (failures.length ? ` (degraded: ${failures.length} feed(s) down)` : '')
  );
  console.log(unchanged ? 'No change since last run; nothing to commit.' : 'Data changed.');
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
