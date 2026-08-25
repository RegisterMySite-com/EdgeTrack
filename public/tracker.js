/**
 * EdgeTrack - Lightweight, Privacy-First Cloudflare-Native Web Analytics Tracker
 * Size: < 8KB minified & uncompressed pure vanilla JS
 */
(function (window, document) {
  'use strict';

  // Prevent multiple initializations
  if (window.__EdgeTrackLoaded) return;
  window.__EdgeTrackLoaded = true;

  // Find script element and site ID configuration
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.indexOf('tracker.js') !== -1) {
        return scripts[i];
      }
    }
    return scripts[scripts.length - 1];
  })();

  var siteId = script ? (script.getAttribute('data-site-id') || script.getAttribute('data-site')) : null;
  
  // If no siteId found in script tag, check global config or window location params
  if (!siteId && window.EdgeTrackConfig) {
    siteId = window.EdgeTrackConfig.siteId;
  }

  // Fallback endpoint calculation (resolves relative to current origin or script source)
  var endpoint = (function () {
    if (script && script.src) {
      try {
        var u = new URL(script.src);
        return u.origin + '/api/v1/beacon';
      } catch (e) {}
    }
    return '/api/v1/beacon';
  })();

  if (window.EdgeTrackConfig && window.EdgeTrackConfig.endpoint) {
    endpoint = window.EdgeTrackConfig.endpoint;
  }

  // Honor Privacy Preferences (Do Not Track & Global Privacy Control)
  var honorDNT = script ? script.getAttribute('data-honor-dnt') !== 'false' : true;
  if (honorDNT) {
    var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
    var gpc = navigator.globalPrivacyControl;
    if (dnt === '1' || dnt === 'yes' || gpc === true) {
      console.log('[EdgeTrack] Do Not Track / Global Privacy Control enabled. Tracking disabled.');
      return;
    }
  }

  // Persistence helpers (First-party Cookie + LocalStorage)
  function getItem(key) {
    try {
      if (window.localStorage) {
        var v = localStorage.getItem(key);
        if (v) return v;
      }
    } catch (e) {}
    var m = document.cookie.match(new RegExp('(?:^|; )' + key + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setItem(key, value, days) {
    try {
      if (window.localStorage) {
        localStorage.setItem(key, value);
      }
    } catch (e) {}
    try {
      var d = new Date();
      d.setTime(d.getTime() + (days || 365) * 86400000);
      document.cookie = key + '=' + encodeURIComponent(value) + '; expires=' + d.toUTCString() + '; path=/; SameSite=Lax';
    } catch (e) {}
  }

  // Generate or retrieve persistent Visitor ID
  function getVisitorId() {
    var vid = getItem('et_vid');
    if (!vid) {
      vid = 'v_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      setItem('et_vid', vid, 365);
    }
    return vid;
  }

  // Get and update Visitor Visit Count
  function getVisitCount() {
    var lastVisit = parseInt(getItem('et_last_visit') || '0', 10);
    var visits = parseInt(getItem('et_visits') || '0', 10);
    var now = Date.now();

    // Consider a new visit if inactive for > 30 minutes
    if (!lastVisit || (now - lastVisit) > 30 * 60 * 1000) {
      visits += 1;
      setItem('et_visits', visits.toString(), 365);
    }
    setItem('et_last_visit', now.toString(), 365);
    return visits;
  }

  // Generate Session ID (expires after 30 mins of inactivity)
  function getSessionId() {
    var sid = getItem('et_sid');
    var stime = parseInt(getItem('et_stime') || '0', 10);
    var now = Date.now();

    if (!sid || !stime || (now - stime) > 30 * 60 * 1000) {
      sid = 's_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      setItem('et_sid', sid, 1);
    }
    setItem('et_stime', now.toString(), 1);
    return sid;
  }

  // Parse UTM parameters from current URL
  function getUTMParams() {
    var params = {};
    try {
      var searchParams = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (key) {
        if (searchParams.has(key)) {
          params[key] = searchParams.get(key);
        }
      });
    } catch (e) {}
    return params;
  }

  // Get Landing Page (stores initial URL per session)
  function getLandingPage() {
    var landing = getItem('et_landing');
    if (!landing) {
      landing = window.location.href;
      setItem('et_landing', landing, 1);
    }
    return landing;
  }

  // Get Device Type heuristic
  function getDeviceType() {
    var ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
    if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) return 'mobile';
    return 'desktop';
  }

  // Timezone lookup
  function getTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      return '';
    }
  }

  // Core state variables
  var visitorId = getVisitorId();
  var visitCount = getVisitCount();
  var sessionId = getSessionId();
  var landingPage = getLandingPage();
  var pageStartTime = Date.now();
  var totalActiveTime = 0; // In seconds
  var lastActiveTimestamp = Date.now();
  var isVisible = !document.hidden;

  // Engagement tracking state
  var maxScrollDepth = 0;
  var scrollMilestonesFired = { 25: false, 50: false, 75: false, 100: false };
  var clicks = [];
  var pauses = [];
  var formInteractions = [];
  var pauseStartTime = null;
  var lastActivityTime = Date.now();
  var pauseCheckInterval = null;

  // Offline / failure queue (persisted lightly)
  var pendingQueue = [];
  try {
    var storedQ = getItem('et_queue');
    if (storedQ) pendingQueue = JSON.parse(storedQ) || [];
  } catch (e) {}

  function persistQueue() {
    try {
      setItem('et_queue', JSON.stringify(pendingQueue.slice(-20)), 1);
    } catch (e) {}
  }

  function flushQueue() {
    if (!pendingQueue.length || !navigator.onLine) return;
    var item = pendingQueue.shift();
    persistQueue();
    actuallySend(item.payload, item.isSync, function (ok) {
      if (!ok) {
        pendingQueue.unshift(item);
        persistQueue();
      } else if (pendingQueue.length) {
        setTimeout(flushQueue, 200);
      }
    });
  }

  window.addEventListener('online', function () { setTimeout(flushQueue, 500); });

  function actuallySend(payload, isSync, cb) {
    var jsonString = JSON.stringify(payload);
    var done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      if (cb) cb(ok);
    }

    if (navigator.sendBeacon && !isSync) {
      try {
        var blob = new Blob([jsonString], { type: 'application/json' });
        var ok = navigator.sendBeacon(endpoint, blob);
        if (ok) {
          finish(true);
          return;
        }
      } catch (e) {}
    }

    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonString,
        keepalive: true
      }).then(function (r) {
        finish(r.ok);
      }).catch(function () {
        finish(false);
      });
    } catch (e) {
      finish(false);
    }
  }

  // Track Beacon Dispatcher (queue + retry + graceful degradation)
  function sendBeaconData(eventType, extraData, isSync) {
    if (!siteId) return;

    var now = Date.now();
    // Update active time
    if (isVisible) {
      totalActiveTime += Math.round((now - lastActiveTimestamp) / 1000);
      lastActiveTimestamp = now;
    }

    var payload = {
      site_id: siteId,
      visitor_id: visitorId,
      visit_count: visitCount,
      session_id: sessionId,
      event_type: eventType, // 'pageview', 'heartbeat', 'engagement', 'exit'
      landing_page: landingPage,
      current_url: window.location.href,
      referrer: document.referrer || '',
      utm: getUTMParams(),
      user_agent: navigator.userAgent,
      browser_language: navigator.language || navigator.userLanguage || '',
      timezone: getTimezone(),
      screen_res: window.screen.width + 'x' + window.screen.height,
      viewport_res: window.innerWidth + 'x' + window.innerHeight,
      device_type: getDeviceType(),
      time_on_page: Math.max(0, totalActiveTime),
      session_duration: Math.round((now - pageStartTime) / 1000),
      scroll_depth: maxScrollDepth,
      timestamp_iso: new Date(now).toISOString(),
      timestamp_unix: Math.floor(now / 1000),
      extra: extraData || {}
    };

    actuallySend(payload, isSync, function (ok) {
      if (!ok) {
        pendingQueue.push({ payload: payload, isSync: !!isSync, ts: Date.now() });
        if (pendingQueue.length > 30) pendingQueue = pendingQueue.slice(-30);
        persistQueue();
      }
    });
  }

  // Attempt to flush any queued beacons on load
  setTimeout(flushQueue, 1500);

  // --- Scroll Depth Tracker ---
  function checkScrollDepth() {
    var docHeight = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight, document.documentElement.offsetHeight,
      document.body.clientHeight, document.documentElement.clientHeight
    ) - window.innerHeight;

    if (docHeight <= 0) return;

    var scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    var currentDepth = Math.min(100, Math.round((scrollTop / docHeight) * 100));

    if (currentDepth > maxScrollDepth) {
      maxScrollDepth = currentDepth;
    }

    [25, 50, 75, 100].forEach(function (m) {
      if (maxScrollDepth >= m && !scrollMilestonesFired[m]) {
        scrollMilestonesFired[m] = true;
        sendBeaconData('engagement', {
          action: 'scroll_milestone',
          milestone: m,
          scroll_depth: m
        });
      }
    });
  }

  // Click tracking
  function setupClickTracking() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.tagName) return;
      var tag = t.tagName.toLowerCase();
      var text = (t.innerText || t.value || '').substring(0, 80).trim();
      sendBeaconData('engagement', {
        action: 'click',
        tag: tag,
        id: t.id || '',
        class_name: (t.className && typeof t.className === 'string') ? t.className.substring(0, 100) : '',
        text: text,
        href: t.href || t.getAttribute('href') || ''
      });
    }, true);
  }

  // Activity / inactivity (pause) tracking
  function setupActivityTracking() {
    function markActive() {
      lastActivityTime = Date.now();
      if (pauseStartTime) {
        var duration = Math.round((Date.now() - pauseStartTime) / 1000);
        if (duration >= 5) {
          sendBeaconData('engagement', { action: 'pause', duration: duration });
        }
        pauseStartTime = null;
      }
    }
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (evt) {
      document.addEventListener(evt, markActive, { passive: true });
    });
    pauseCheckInterval = setInterval(function () {
      if (!pauseStartTime && (Date.now() - lastActivityTime) > 5000) {
        pauseStartTime = lastActivityTime;
      }
    }, 2000);
  }

  // Form focus tracking (no keystrokes)
  function setupFormTracking() {
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
        sendBeaconData('engagement', {
          action: 'form_focus',
          tag: t.tagName.toLowerCase(),
          id: t.id || '',
          name: t.name || ''
        });
      }
    }, true);
  }

  // Heartbeat + pageview + visibility + exit
  function setupHeartbeat() {
    sendBeaconData('pageview');
    setInterval(function () {
      if (isVisible) sendBeaconData('heartbeat');
    }, 10000);

    document.addEventListener('visibilitychange', function () {
      var now = Date.now();
      if (document.hidden) {
        if (isVisible) {
          totalActiveTime += Math.round((now - lastActiveTimestamp) / 1000);
        }
        isVisible = false;
        sendBeaconData('heartbeat');
      } else {
        isVisible = true;
        lastActiveTimestamp = now;
      }
    });

    window.addEventListener('pagehide', function () {
      sendBeaconData('exit', {
        exit_type: 'tab_close_or_navigate'
      }, true);
    });
  }

  // Initialize listeners
  window.addEventListener('scroll', checkScrollDepth, { passive: true });
  setupClickTracking();
  setupActivityTracking();
  setupFormTracking();

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setupHeartbeat();
  } else {
    document.addEventListener('DOMContentLoaded', setupHeartbeat);
  }

  // Expose global EdgeTrack object for API or iframe mode
  window.EdgeTrack = {
    siteId: siteId,
    visitorId: visitorId,
    sessionId: sessionId,
    trackEvent: function (eventName, eventProps) {
      sendBeaconData('custom_event', {
        event_name: eventName,
        props: eventProps || {}
      });
    }
  };

})(window, document);
