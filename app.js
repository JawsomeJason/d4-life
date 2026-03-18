/**
 * D4 Helltide Tracker
 * Data: Firebase helltides-7e530 (via GitHub Actions every 5 min)
 */

(function () {
  'use strict';

  const CONFIG = {
    apiUrl: 'data/helltide.json',
    refreshInterval: 60,
    helltideDuration:  55 * 60 * 1000,
    worldBossDuration: 15 * 60 * 1000,
    legionDuration:    25 * 60 * 1000,
  };

  const ZONE_NAMES = {
    fractured_peaks: 'Fractured Peaks',
    scosglen:        'Scosglen',
    dry_steppes:     'Dry Steppes',
    kehjistan:       'Kehjistan',
    hawezar:         'Hawezar',
    nahantu:         'Nahantu',
  };

  const el = {
    announcer:    document.getElementById('live-announcer'),
    lastUpdated:  document.getElementById('last-updated-time'),
    countdown:    document.getElementById('countdown'),
    refreshBtn:   document.getElementById('refresh-btn'),
    retryBtn:     document.getElementById('retry-btn'),
    loadingState: document.getElementById('loading-state'),
    errorState:   document.getElementById('error-state'),
    errorMessage: document.getElementById('error-message'),
    emptyState:   document.getElementById('empty-state'),
    helltideList: document.getElementById('helltide-list'),
  };

  let countdownTimer = null;
  let countdownValue = CONFIG.refreshInterval;
  let isLoading = false;

  // ── Screen reader ─────────────────────────────────────────────────────────

  function announce(msg) {
    el.announcer.textContent = '';
    setTimeout(() => { el.announcer.textContent = msg; }, 100);
  }

  // ── Time helpers ──────────────────────────────────────────────────────────

  function ts(v) {
    return typeof v === 'number' ? v : new Date(v).getTime();
  }

  function formatTime(t) {
    return new Date(ts(t)).toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  function formatDateTime(t) {
    return new Date(ts(t)).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  function diffParts(ms) {
    const a = Math.abs(ms);
    return { h: Math.floor(a / 3_600_000), m: Math.floor((a % 3_600_000) / 60_000) };
  }

  // Short display — "In 34m" / "In 1h 20m"
  function shortUntil(t, now) {
    const ms = ts(t) - now;
    if (ms <= 0) return 'Now';
    const { h, m } = diffParts(ms);
    return h > 0 ? `In ${h}h ${m}m` : `In ${m}m`;
  }

  // Verbose aria — "in 34 minutes" / "in 1 hour 20 minutes"
  function longUntil(t, now) {
    const ms = ts(t) - now;
    if (ms <= 0) return 'now';
    const { h, m } = diffParts(ms);
    if (h > 0) return `in ${h} hour${h !== 1 ? 's' : ''} ${m} minute${m !== 1 ? 's' : ''}`;
    return `in ${m} minute${m !== 1 ? 's' : ''}`;
  }

  // Short display — "34m left" / "1h 20m left"
  function shortRemaining(endT, now) {
    const ms = ts(endT) - now;
    if (ms <= 0) return 'ending';
    const { h, m } = diffParts(ms);
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }

  // Verbose aria — "34 minutes remaining"
  function longRemaining(endT, now) {
    const ms = ts(endT) - now;
    if (ms <= 0) return 'ending soon';
    const { h, m } = diffParts(ms);
    if (h > 0) return `${h} hour${h !== 1 ? 's' : ''} ${m} minute${m !== 1 ? 's' : ''} remaining`;
    return `${m} minute${m !== 1 ? 's' : ''} remaining`;
  }

  function zoneName(id) {
    return ZONE_NAMES[id] || id || 'Unknown';
  }

  // ── Icons ─────────────────────────────────────────────────────────────────

  const EVENT_ICONS = {
    'Helltide':     'ph-fire-simple',
    'World Boss':   'ph-skull',
    'Legion Event': 'ph-sword',
    'Upcoming':     'ph-calendar-dots',
  };

  const STATUS_ICONS = {
    active:   { icon: 'ph-pulse',    label: 'Active Now' },
    upcoming: { icon: 'ph-clock',    label: 'Upcoming' },
    ended:    { icon: 'ph-x-circle', label: 'Ended' },
  };

  function eventIcon(title) {
    const key = Object.keys(EVENT_ICONS).find(k => title.startsWith(k));
    return `<i class="ph-bold ${key ? EVENT_ICONS[key] : 'ph-calendar-dots'}" aria-hidden="true"></i>`;
  }

  function statusBadge(s) {
    const d = STATUS_ICONS[s] || STATUS_ICONS.ended;
    return `<i class="ph-bold ${d.icon}" aria-hidden="true"></i> ${d.label}`;
  }

  // ── Card builder ──────────────────────────────────────────────────────────
  //
  // Row shape:
  //   { label, short, ariaLabel, full?, ts? }
  //   - short:     concise display text ("in 34m")
  //   - ariaLabel: verbose screen reader text ("in 34 minutes")
  //   - full:      expansion text shown on tap ("Mar 18, 3:00 AM") — optional
  //   - ts:        ISO/ms for <time datetime> — optional

  function buildCard({ title, statusData, ariaLabel, rows }) {
    const li = document.createElement('li');
    const article = document.createElement('article');
    article.className = 'helltide-card';
    article.setAttribute('data-status', statusData);
    article.setAttribute('aria-label', ariaLabel);

    const rowsHtml = rows.map(({ label, short, ariaLabel: rowAria, full, ts: t }) => {
      const dtAttr = t ? ` datetime="${new Date(ts(t)).toISOString()}"` : '';
      const expandBtn = full
        ? `<button class="detail-value expandable" aria-expanded="false" aria-label="${rowAria || short}">
             <span class="detail-short">${short}</span>
             <time class="detail-expanded"${dtAttr} hidden>${full}</time>
             <i class="ph-bold ph-caret-down expand-icon" aria-hidden="true"></i>
           </button>`
        : `<span class="detail-value"${t ? ` role="text"` : ''}>${short}</span>`;

      return `<div class="detail-item">${
        `<span class="detail-label">${label}</span>${expandBtn}`
      }</div>`;
    }).join('');

    article.innerHTML = `
      <header class="card-header">
        <h3 class="location-name">${eventIcon(title)} ${title}</h3>
        <span class="status-badge" data-status="${statusData}" aria-hidden="true">${statusBadge(statusData)}</span>
      </header>
      <div class="card-details">${rowsHtml}</div>
    `;

    // Wire up expand/collapse
    article.querySelectorAll('.expandable').forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const detail = btn.querySelector('.detail-expanded');
        btn.setAttribute('aria-expanded', String(!expanded));
        detail.hidden = expanded;
        btn.classList.toggle('is-expanded', !expanded);
      });
    });

    li.appendChild(article);
    return li;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderAll(data) {
    const now = Date.now();
    el.helltideList.innerHTML = '';
    const summaries = [];

    // ── Helltide ──────────────────────────────────────────────────────────
    const ht = data.helltide;
    if (ht) {
      const start    = ts(ht.startTime);
      const end      = ts(ht.endTime || (start + CONFIG.helltideDuration));
      const zone     = zoneName(ht.zone);
      const active   = now >= start && now < end;
      const upcoming = start > now;
      const chests   = Array.isArray(ht.chests) && ht.chests.length ? ht.chests.join(' & ') : null;
      let statusData, ariaLabel, rows;

      if (active) {
        statusData = 'active';
        ariaLabel = `Helltide active in ${zone}. ${longRemaining(end, now)}.${chests ? ' Mystery Chests: ' + chests + '.' : ''}`;
        rows = [
          { label: 'Zone',    short: zone,                  ariaLabel: zone },
          { label: 'Time',    short: shortRemaining(end, now), ariaLabel: longRemaining(end, now), full: `Ends ${formatDateTime(end)}`, ts: end },
          ...(chests ? [{ label: 'Chests', short: chests, ariaLabel: `Mystery Chests: ${chests}` }] : []),
        ];
        summaries.push(`Helltide active in ${zone} — ${longRemaining(end, now)}${chests ? '. Chests: ' + chests : ''}`);
      } else if (upcoming) {
        statusData = 'upcoming';
        ariaLabel = `Next Helltide in ${zone}, ${longUntil(start, now)}.${chests ? ' Mystery Chests: ' + chests + '.' : ''}`;
        rows = [
          { label: 'Zone',   short: zone,                ariaLabel: zone },
          { label: 'Starts', short: shortUntil(start, now), ariaLabel: longUntil(start, now), full: formatDateTime(start), ts: start },
          ...(chests ? [{ label: 'Chests', short: chests, ariaLabel: `Mystery Chests: ${chests}` }] : []),
        ];
        summaries.push(`Helltide in ${zone} ${longUntil(start, now)}`);
      } else {
        statusData = 'ended';
        ariaLabel = `Helltide in ${zone} has ended.`;
        rows = [
          { label: 'Zone',   short: zone, ariaLabel: zone },
          { label: 'Status', short: 'Ended', ariaLabel: 'Ended', full: `Last: ${formatDateTime(start)}`, ts: start },
        ];
        summaries.push('Helltide ended');
      }

      el.helltideList.appendChild(buildCard({ title: 'Helltide', statusData, ariaLabel, rows }));
    }

    // ── World Boss ────────────────────────────────────────────────────────
    const wb = data.world_boss;
    if (wb) {
      const start    = ts(wb.startTime);
      const end      = start + CONFIG.worldBossDuration;
      const boss     = wb.boss || 'Unknown';
      const zones    = Array.isArray(wb.zone) ? wb.zone.map(z => z.name).join(' & ') : zoneName(wb.zone);
      const active   = now >= start && now < end;
      const upcoming = start > now;
      let statusData, ariaLabel, rows;

      if (active) {
        statusData = 'active';
        ariaLabel = `World Boss ${boss} active in ${zones}. ${longRemaining(end, now)}.`;
        rows = [
          { label: 'Boss',  short: boss,  ariaLabel: boss },
          { label: 'Zone',  short: zones, ariaLabel: zones },
          { label: 'Time',  short: shortRemaining(end, now), ariaLabel: longRemaining(end, now), full: `Ends ${formatDateTime(end)}`, ts: end },
        ];
        summaries.push(`World Boss ${boss} active — ${longRemaining(end, now)}`);
      } else if (upcoming) {
        statusData = 'upcoming';
        ariaLabel = `World Boss ${boss} in ${zones}, ${longUntil(start, now)}.`;
        rows = [
          { label: 'Boss',   short: boss,  ariaLabel: boss },
          { label: 'Zone',   short: zones, ariaLabel: zones },
          { label: 'Starts', short: shortUntil(start, now), ariaLabel: longUntil(start, now), full: formatDateTime(start), ts: start },
        ];
        summaries.push(`World Boss ${boss} in ${zones} ${longUntil(start, now)}`);
      } else {
        statusData = 'ended';
        ariaLabel = `World Boss ${boss} in ${zones} has ended.`;
        rows = [
          { label: 'Boss',   short: boss,  ariaLabel: boss },
          { label: 'Zone',   short: zones, ariaLabel: zones },
          { label: 'Status', short: 'Ended', ariaLabel: 'Ended', full: `Last: ${formatDateTime(start)}`, ts: start },
          ...(wb.nextTime ? [{ label: 'Next', short: shortUntil(wb.nextTime, now), ariaLabel: longUntil(wb.nextTime, now), full: formatDateTime(wb.nextTime), ts: wb.nextTime }] : []),
        ];
        summaries.push(`World Boss ${boss} ended`);
      }

      el.helltideList.appendChild(buildCard({ title: 'World Boss', statusData, ariaLabel, rows }));
    }

    // ── Legion Event ──────────────────────────────────────────────────────
    const lg = data.legion;
    if (lg) {
      const start    = ts(lg.startTime);
      const end      = start + CONFIG.legionDuration;
      const active   = now >= start && now < end;
      const upcoming = start > now;
      let statusData, ariaLabel, rows;

      if (active) {
        statusData = 'active';
        ariaLabel = `Legion Event active. ${longRemaining(end, now)}.`;
        rows = [
          { label: 'Time', short: shortRemaining(end, now), ariaLabel: longRemaining(end, now), full: `Ends ${formatDateTime(end)}`, ts: end },
        ];
        summaries.push(`Legion Event active — ${longRemaining(end, now)}`);
      } else if (upcoming) {
        statusData = 'upcoming';
        ariaLabel = `Legion Event ${longUntil(start, now)}.`;
        rows = [
          { label: 'Starts',     short: shortUntil(start, now), ariaLabel: longUntil(start, now), full: formatDateTime(start), ts: start },
          ...(lg.nextTime ? [{ label: 'After that', short: shortUntil(lg.nextTime, now), ariaLabel: longUntil(lg.nextTime, now), full: formatDateTime(lg.nextTime), ts: lg.nextTime }] : []),
        ];
        summaries.push(`Legion Event ${longUntil(start, now)}`);
      } else {
        statusData = 'ended';
        ariaLabel = 'Legion Event ended.';
        rows = [
          { label: 'Status', short: 'Ended', ariaLabel: 'Ended', full: `Last: ${formatDateTime(start)}`, ts: start },
          ...(lg.nextTime ? [{ label: 'Next', short: shortUntil(lg.nextTime, now), ariaLabel: longUntil(lg.nextTime, now), full: formatDateTime(lg.nextTime), ts: lg.nextTime }] : []),
        ];
        summaries.push('Legion Event ended');
      }

      el.helltideList.appendChild(buildCard({ title: 'Legion Event', statusData, ariaLabel, rows }));
    }

    // ── Upcoming Events ───────────────────────────────────────────────────
    const upcomingData = data.upcoming;
    if (upcomingData) {
      const items = [];

      (upcomingData.world_boss || []).forEach(e => {
        const zones = Array.isArray(e.zone) ? e.zone.map(z => z.name).join(' & ') : zoneName(e.zone);
        items.push({
          label: `Boss — ${e.boss}`,
          short: shortUntil(e.startTime, now),
          ariaLabel: `World Boss ${e.boss} in ${zones}, ${longUntil(e.startTime, now)}`,
          full: `${formatDateTime(e.startTime)} · ${zones}`,
          ts: e.startTime,
        });
      });

      (upcomingData.helltide || []).forEach(e => {
        items.push({
          label: 'Helltide',
          short: shortUntil(e.startTime, now),
          ariaLabel: `Helltide ${longUntil(e.startTime, now)}`,
          full: formatDateTime(e.startTime),
          ts: e.startTime,
        });
      });

      (upcomingData.legion || []).forEach(e => {
        items.push({
          label: 'Legion',
          short: shortUntil(e.startTime, now),
          ariaLabel: `Legion Event ${longUntil(e.startTime, now)}`,
          full: formatDateTime(e.startTime),
          ts: e.startTime,
        });
      });

      if (items.length) {
        items.sort((a, b) => ts(a.ts) - ts(b.ts));
        el.helltideList.appendChild(buildCard({
          title: 'Upcoming',
          statusData: 'upcoming',
          ariaLabel: 'Upcoming events: ' + items.map(i => i.ariaLabel).join('. '),
          rows: items,
        }));
      }
    }

    if (el.helltideList.children.length === 0) { showState('empty'); return; }
    showState('list');
    announce('Data updated. ' + summaries.join('. ') + '.');
  }

  // ── UI state ──────────────────────────────────────────────────────────────

  function showState(state) {
    el.loadingState.hidden = state !== 'loading';
    el.errorState.hidden   = state !== 'error';
    el.emptyState.hidden   = state !== 'empty';
    el.helltideList.hidden = state !== 'list';
  }

  function updateLastUpdated() {
    const now = new Date();
    el.lastUpdated.textContent = formatTime(now.getTime());
    el.lastUpdated.setAttribute('datetime', now.toISOString());
  }

  // ── Countdown ─────────────────────────────────────────────────────────────

  function startCountdown() {
    countdownValue = CONFIG.refreshInterval;
    el.countdown.textContent = countdownValue;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      countdownValue--;
      el.countdown.textContent = countdownValue;
      if (countdownValue <= 0) fetchData();
    }, 1000);
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  async function fetchData() {
    if (isLoading) return;
    isLoading = true;
    el.refreshBtn.disabled = true;
    if (el.helltideList.children.length === 0) showState('loading');

    try {
      const res = await fetch(CONFIG.apiUrl + '?_=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderAll(data);
      updateLastUpdated();
      startCountdown();
    } catch (err) {
      console.error(err);
      el.errorMessage.textContent = `Unable to load data. ${err.message}`;
      showState('error');
      announce('Error loading data. Use the retry button to try again.');
      startCountdown();
    } finally {
      isLoading = false;
      el.refreshBtn.disabled = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    el.refreshBtn.addEventListener('click', () => { announce('Refreshing...'); fetchData(); });
    el.retryBtn.addEventListener('click',   () => { announce('Retrying...');   fetchData(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && countdownValue <= 0) fetchData();
    });
    fetchData();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

})();
