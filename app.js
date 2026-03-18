/**
 * D4 Helltide Tracker
 * Data: Firebase helltides-7e530 (via GitHub Actions every 5 min)
 * Shows: Helltide (with zone), World Boss, Legion Event
 */

(function () {
  'use strict';

  const CONFIG = {
    apiUrl: 'data/helltide.json',
    refreshInterval: 60,
    helltideDuration:  55 * 60 * 1000, // 55 min (Season 6+)
    worldBossDuration: 15 * 60 * 1000,
    legionDuration:    25 * 60 * 1000,
  };

  // Human-readable zone names
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

  function ts(isoOrMs) {
    return typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
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

  function humanUntil(t, now) {
    const ms = ts(t) - now;
    if (ms <= 0) return 'now';
    const { h, m } = diffParts(ms);
    return h > 0 ? `in ${h}h ${m}m` : `in ${m} min`;
  }

  function humanRemaining(endT, now) {
    const ms = ts(endT) - now;
    if (ms <= 0) return 'ending soon';
    const { h, m } = diffParts(ms);
    return h > 0 ? `${h}h ${m}m remaining` : `${m} min remaining`;
  }

  function zoneName(id) {
    return ZONE_NAMES[id] || id || 'Unknown Zone';
  }

  // ── Icons ─────────────────────────────────────────────────────────────────

  const EVENT_ICONS = {
    'Helltide':     'ph-fire-simple',
    'World Boss':   'ph-skull',
    'Legion Event': 'ph-sword',
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

  function statusBadge(statusData) {
    const s = STATUS_ICONS[statusData] || STATUS_ICONS.ended;
    return `<i class="ph-bold ${s.icon}" aria-hidden="true"></i> ${s.label}`;
  }

  // ── Card builder ──────────────────────────────────────────────────────────

  function buildCard({ title, statusData, ariaLabel, rows }) {
    const li = document.createElement('li');
    const article = document.createElement('article');
    article.className = 'helltide-card';
    article.setAttribute('data-status', statusData);
    article.setAttribute('aria-label', ariaLabel);

    const rowsHtml = rows.map(({ label, value, ts: t }) => `
      <div class="detail-item">
        <span class="detail-label">${label}</span>
        ${t ? `<time class="detail-value" datetime="${new Date(ts(t)).toISOString()}">${value}</time>`
             : `<span class="detail-value">${value}</span>`}
      </div>`).join('');

    article.innerHTML = `
      <header class="card-header">
        <h3 class="location-name">${eventIcon(title)} ${title}</h3>
        <span class="status-badge" data-status="${statusData}" aria-hidden="true">${statusBadge(statusData)}</span>
      </header>
      <div class="card-details">${rowsHtml}</div>
    `;

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
      const start  = ts(ht.startTime);
      const end    = ts(ht.endTime || (start + CONFIG.helltideDuration));
      const zone   = zoneName(ht.zone);
      const active = now >= start && now < end;
      const upcoming = start > now;
      let statusData, ariaLabel, rows;

      if (active) {
        statusData = 'active';
        ariaLabel = `Helltide active in ${zone}. ${humanRemaining(end, now)}.`;
        rows = [
          { label: 'Zone',       value: zone },
          { label: 'Status',     value: humanRemaining(end, now) },
          { label: 'Started',    value: formatDateTime(start), ts: start },
          { label: 'Ends at',    value: formatDateTime(end),   ts: end },
        ];
        summaries.push(`Helltide active in ${zone} — ${humanRemaining(end, now)}`);
      } else if (upcoming) {
        statusData = 'upcoming';
        ariaLabel = `Next Helltide in ${zone}, ${humanUntil(start, now)}.`;
        rows = [
          { label: 'Zone',       value: zone },
          { label: 'Starts',     value: `${humanUntil(start, now)} — ${formatDateTime(start)}`, ts: start },
        ];
        summaries.push(`Helltide in ${zone} ${humanUntil(start, now)}`);
      } else {
        statusData = 'ended';
        ariaLabel = `Helltide in ${zone} has ended. Waiting for next.`;
        rows = [
          { label: 'Zone',      value: zone },
          { label: 'Last spawn', value: formatDateTime(start), ts: start },
          { label: 'Next',      value: 'Waiting for update…' },
        ];
        summaries.push('Helltide ended — awaiting next');
      }

      el.helltideList.appendChild(buildCard({ title: 'Helltide', statusData, ariaLabel, rows }));
    }

    // ── World Boss ────────────────────────────────────────────────────────
    const wb = data.world_boss;
    if (wb) {
      const start    = ts(wb.startTime);
      const end      = start + CONFIG.worldBossDuration;
      const bossName = wb.boss || 'World Boss';
      const zones    = Array.isArray(wb.zone)
        ? wb.zone.map(z => z.name).join(' & ')
        : zoneName(wb.zone);
      const active   = now >= start && now < end;
      const upcoming = start > now;
      let statusData, ariaLabel, rows;

      if (active) {
        statusData = 'active';
        ariaLabel = `World Boss ${bossName} active in ${zones}. ${humanRemaining(end, now)}.`;
        rows = [
          { label: 'Boss',    value: bossName },
          { label: 'Zone',    value: zones },
          { label: 'Status',  value: humanRemaining(end, now) },
          { label: 'Ends at', value: formatDateTime(end), ts: end },
        ];
        summaries.push(`World Boss ${bossName} active — ${humanRemaining(end, now)}`);
      } else if (upcoming) {
        statusData = 'upcoming';
        ariaLabel = `World Boss ${bossName} in ${zones}, ${humanUntil(start, now)}.`;
        rows = [
          { label: 'Boss',   value: bossName },
          { label: 'Zone',   value: zones },
          { label: 'Starts', value: `${humanUntil(start, now)} — ${formatDateTime(start)}`, ts: start },
        ];
        summaries.push(`World Boss ${bossName} in ${zones} ${humanUntil(start, now)}`);
      } else {
        statusData = 'ended';
        ariaLabel = `World Boss ${bossName} in ${zones} has ended.`;
        rows = [
          { label: 'Boss',      value: bossName },
          { label: 'Zone',      value: zones },
          { label: 'Last seen', value: formatDateTime(start), ts: start },
          ...(wb.nextTime ? [{ label: 'Next', value: formatDateTime(wb.nextTime), ts: wb.nextTime }] : []),
        ];
        summaries.push(`World Boss ${bossName} ended`);
      }

      el.helltideList.appendChild(buildCard({ title: 'World Boss', statusData, ariaLabel, rows }));
    }

    // ── Legion Event ──────────────────────────────────────────────────────
    const lg = data.legion;
    if (lg) {
      const start  = ts(lg.startTime);
      const end    = start + CONFIG.legionDuration;
      const active = now >= start && now < end;
      const upcoming = start > now;
      let statusData, ariaLabel, rows;

      if (active) {
        statusData = 'active';
        ariaLabel = `Legion Event active. ${humanRemaining(end, now)}.`;
        rows = [
          { label: 'Status',  value: humanRemaining(end, now) },
          { label: 'Ends at', value: formatDateTime(end), ts: end },
        ];
        summaries.push(`Legion Event active — ${humanRemaining(end, now)}`);
      } else if (upcoming) {
        statusData = 'upcoming';
        ariaLabel = `Legion Event ${humanUntil(start, now)}.`;
        rows = [
          { label: 'Starts', value: `${humanUntil(start, now)} — ${formatDateTime(start)}`, ts: start },
          ...(lg.nextTime ? [{ label: 'After that', value: formatDateTime(lg.nextTime), ts: lg.nextTime }] : []),
        ];
        summaries.push(`Legion Event ${humanUntil(start, now)}`);
      } else {
        statusData = 'ended';
        ariaLabel = 'Legion Event ended.';
        rows = [
          { label: 'Last seen', value: formatDateTime(start), ts: start },
          ...(lg.nextTime ? [{ label: 'Next', value: formatDateTime(lg.nextTime), ts: lg.nextTime }] : []),
        ];
        summaries.push('Legion Event ended');
      }

      el.helltideList.appendChild(buildCard({ title: 'Legion Event', statusData, ariaLabel, rows }));
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
