/**
 * D4 Helltide Tracker - Accessible JavaScript
 *
 * Data source: diablo4.life/api/trackers/list (fetched every 5 min via GitHub Actions)
 * Shows live next/active Helltide spawn time with full screen reader support.
 */

(function () {
  'use strict';

  const CONFIG = {
    apiUrl: 'data/helltide.json',
    refreshInterval: 60, // seconds
    helltideDuration: 60 * 60 * 1000, // 60 minutes in ms
  };

  // DOM refs
  const el = {
    announcer:     document.getElementById('live-announcer'),
    lastUpdated:   document.getElementById('last-updated-time'),
    countdown:     document.getElementById('countdown'),
    refreshBtn:    document.getElementById('refresh-btn'),
    retryBtn:      document.getElementById('retry-btn'),
    loadingState:  document.getElementById('loading-state'),
    errorState:    document.getElementById('error-state'),
    errorMessage:  document.getElementById('error-message'),
    emptyState:    document.getElementById('empty-state'),
    helltideList:  document.getElementById('helltide-list'),
  };

  let countdownTimer = null;
  let countdownValue = CONFIG.refreshInterval;
  let isLoading = false;

  // ── Screen reader announcements ──────────────────────────────────────────

  function announce(msg) {
    el.announcer.textContent = '';
    setTimeout(() => { el.announcer.textContent = msg; }, 100);
  }

  // ── Time helpers ─────────────────────────────────────────────────────────

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  function formatDateTime(ts) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  function diffParts(ms) {
    const total = Math.abs(ms);
    const h = Math.floor(total / 3_600_000);
    const m = Math.floor((total % 3_600_000) / 60_000);
    const s = Math.floor((total % 60_000) / 1_000);
    return { h, m, s };
  }

  function humanDiff(ms, future) {
    const { h, m } = diffParts(ms);
    const verb = future ? 'Starts in' : 'Started';
    const ago  = future ? '' : ' ago';
    if (h > 0) return `${verb} ${h}h ${m}m${ago}`;
    if (m > 0) return `${verb} ${m} minute${m !== 1 ? 's' : ''}${ago}`;
    return future ? 'Starting very soon' : 'Just started';
  }

  // ── UI state ─────────────────────────────────────────────────────────────

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

  // ── Countdown ────────────────────────────────────────────────────────────

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

  // ── Render ───────────────────────────────────────────────────────────────

  function renderHelltide(data) {
    const now = Date.now();
    const spawnTime = data.helltide?.time;

    if (!spawnTime) {
      showState('empty');
      announce('No Helltide data available.');
      return;
    }

    const diff    = spawnTime - now;
    const endTime = spawnTime + CONFIG.helltideDuration;
    const isActive   = now >= spawnTime && now < endTime;
    const hasEnded   = now >= endTime;
    const isUpcoming = diff > 0;

    let statusLabel, statusDesc, ariaLabel;

    if (isActive) {
      const remaining = endTime - now;
      const { h, m } = diffParts(remaining);
      const timeLeft = h > 0 ? `${h}h ${m}m remaining` : `${m} minute${m !== 1 ? 's' : ''} remaining`;
      statusLabel = 'ACTIVE NOW';
      statusDesc  = `Active — ${timeLeft}`;
      ariaLabel   = `Helltide is active now. ${timeLeft}. Started at ${formatDateTime(spawnTime)}.`;
      announce(`Helltide is active now! ${timeLeft}.`);
    } else if (isUpcoming) {
      statusLabel = 'UPCOMING';
      statusDesc  = humanDiff(diff, true);
      ariaLabel   = `Next Helltide: ${statusDesc}. Spawns at ${formatDateTime(spawnTime)}.`;
      announce(`Next Helltide: ${statusDesc}.`);
    } else {
      // ended — data file might be stale; show last known
      const { h, m } = diffParts(now - endTime);
      const ago = h > 0 ? `${h}h ${m}m ago` : `${m}m ago`;
      statusLabel = 'ENDED';
      statusDesc  = `Ended ${ago} — next spawn time not yet reported`;
      ariaLabel   = `Last Helltide ended ${ago}. Waiting for next spawn time.`;
      announce(`Last Helltide ended ${ago}. Waiting for updated data.`);
    }

    el.helltideList.innerHTML = '';

    const li = document.createElement('li');
    const article = document.createElement('article');
    article.className = 'helltide-card';
    article.setAttribute('data-status', isActive ? 'active' : isUpcoming ? 'upcoming' : 'ended');
    article.setAttribute('aria-label', ariaLabel);

    article.innerHTML = `
      <header class="card-header">
        <h3 class="location-name">Helltide</h3>
        <span class="status-badge" data-status="${isActive ? 'active' : isUpcoming ? 'upcoming' : 'ended'}" aria-hidden="true">
          ${statusLabel}
        </span>
      </header>
      <div class="card-details">
        <div class="detail-item">
          <span class="detail-label">Status</span>
          <span class="detail-value time-relative">${statusDesc}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">${isActive ? 'Started' : 'Spawn Time'}</span>
          <time class="detail-value" datetime="${new Date(spawnTime).toISOString()}">
            ${formatDateTime(spawnTime)}
          </time>
        </div>
        ${isActive ? `
        <div class="detail-item">
          <span class="detail-label">Ends At</span>
          <time class="detail-value" datetime="${new Date(endTime).toISOString()}">
            ${formatDateTime(endTime)}
          </time>
        </div>` : ''}
      </div>
    `;

    li.appendChild(article);
    el.helltideList.appendChild(li);
    showState('list');
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
      renderHelltide(data);
      updateLastUpdated();
      startCountdown();
    } catch (err) {
      console.error(err);
      el.errorMessage.textContent = `Unable to load data. ${err.message}`;
      showState('error');
      announce('Error loading Helltide data. Use the retry button to try again.');
      startCountdown();
    } finally {
      isLoading = false;
      el.refreshBtn.disabled = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    el.refreshBtn.addEventListener('click', () => {
      announce('Refreshing...');
      fetchData();
    });
    el.retryBtn.addEventListener('click', () => {
      announce('Retrying...');
      fetchData();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && countdownValue <= 0) fetchData();
    });
    fetchData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
