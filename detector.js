/*
 * eID Chrome Extension detector — primary: iframe content inspection (A2).
 *
 * Extension ID: bkbdaodnaecdijpajecpncpdomgcoakc (manifest 1.0.3, no WAR).
 */
(function (global) {
  var EXTENSION_ID = "bkbdaodnaecdijpajecpncpdomgcoakc";
  var EXTENSION_ORIGIN = "chrome-extension://" + EXTENSION_ID;
  var SIGNAL_ID = "eid-chrome-extension-is-installed";
  var SIGNAL_TIMEOUT_MS = 2000;
  var EXTENSION_MESSAGE_TYPES = {
    "eid-chrome-extension": true,
    "eid-chrome-extension-response": true,
    "eid-chrome-extension-finish": true
  };
  var IFRAME_PATHS = ["icon128.png", "icon64.png", "icon38.png", "manifest.json"];
  var IFRAME_TIMEOUT_MS = 1200;
  var IFRAME_ROUNDS = 3;
  var HANDSHAKE_WAIT_MS = 350;
  var RUNTIME_CALL_TIMEOUT_MS = 400;
  var RUNTIME_RETRY_DELAY_MS = 500;
  var RUNTIME_VOTE_COUNT = 3;
  var RUNTIME_VOTE_GAP_MS = 100;
  var ALLOWLISTED_PROBE_URL = "https://www.e-contract.be/";
  var ALLOWLISTED_PROBE_LOAD_MS = 14000;
  var ALLOWLISTED_BEACON_WAIT_MS = 4500;
  var ALLOWED_HOSTS = [
    "e-contract.be",
    "ejustice.be",
    "auctionline.be",
    "nkcn-cia.be",
    "jd-consult.be",
    "allsoft.be",
    "orpea.net"
  ];

  function extUrl(path) {
    return EXTENSION_ORIGIN + "/" + path;
  }

  function hostLabels(hostname) {
    var host = String(hostname || "").toLowerCase();
    if (!host || host.charAt(0) === "." || host.indexOf("..") !== -1) {
      return null;
    }
    var labels = host.split(".");
    for (var i = 0; i < labels.length; i++) {
      if (!labels[i]) {
        return null;
      }
    }
    return labels;
  }

  function hostMatches(hostname, allowedHost) {
    var host = hostLabels(hostname);
    var allowed = hostLabels(allowedHost);
    if (!host || !allowed || host.length < allowed.length) {
      return false;
    }
    var offset = host.length - allowed.length;
    for (var i = 0; i < allowed.length; i++) {
      if (host[offset + i] !== allowed[i]) {
        return false;
      }
    }
    return true;
  }

  function pageAllowlisted() {
    for (var i = 0; i < ALLOWED_HOSTS.length; i++) {
      if (hostMatches(location.hostname, ALLOWED_HOSTS[i])) {
        return location.protocol === "https:";
      }
    }
    return false;
  }

  function originAllowlisted(origin) {
    try {
      var parsed = new URL(origin);
      if (parsed.protocol !== "https:") {
        return false;
      }
      for (var i = 0; i < ALLOWED_HOSTS.length; i++) {
        if (hostMatches(parsed.hostname, ALLOWED_HOSTS[i])) {
          return true;
        }
      }
    } catch (ignore) {}
    return false;
  }

  function isLocalHarnessPage() {
    var host = String(location.hostname || "").toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "::1"
    );
  }

  function probeAllowlistedSiteIframe(options) {
    options = options || {};
    var verboseLog = options.verboseLog;

    if (pageAllowlisted()) {
      return Promise.resolve({
        outcome: "SKIPPED",
        skipped: true,
        reason: "already-on-allowlisted-page",
        url: ALLOWLISTED_PROBE_URL
      });
    }
    if (!isLocalHarnessPage()) {
      return Promise.resolve({
        outcome: "SKIPPED",
        skipped: true,
        reason: "not-local-harness",
        url: ALLOWLISTED_PROBE_URL
      });
    }

    return new Promise(function (resolve) {
      var url = ALLOWLISTED_PROBE_URL;
      var iframe = document.createElement("iframe");
      var iframeLoaded = false;
      var seenExtensionMessage = false;
      var messageTypes = [];
      var settled = false;
      var loadTimer = null;
      var beaconTimer = null;

      function finish(outcome, extra) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(loadTimer);
        clearTimeout(beaconTimer);
        window.removeEventListener("message", onMessage);
        iframe.onload = null;
        iframe.onerror = null;
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
        var result = {
          outcome: outcome,
          skipped: false,
          url: url,
          iframeLoaded: iframeLoaded,
          seenExtensionMessage: seenExtensionMessage,
          messageTypes: messageTypes
        };
        if (extra) {
          for (var key in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, key)) {
              result[key] = extra[key];
            }
          }
        }
        resolve(result);
      }

      function onMessage(event) {
        if (!originAllowlisted(event.origin)) {
          return;
        }
        if (!iframe.contentWindow || event.source !== iframe.contentWindow) {
          return;
        }
        if (!event.data || typeof event.data.type !== "string") {
          return;
        }
        if (!EXTENSION_MESSAGE_TYPES[event.data.type]) {
          return;
        }
        seenExtensionMessage = true;
        messageTypes.push(event.data.type);
        if (verboseLog) {
          verboseLog.push({
            t: Date.now(),
            step: "allowlisted iframe extension message",
            type: event.data.type,
            origin: event.origin
          });
        }
        finish("STRONG_POSITIVE");
      }

      window.addEventListener("message", onMessage);

      iframe.onload = function () {
        iframeLoaded = true;
        if (verboseLog) {
          verboseLog.push({ t: Date.now(), step: "allowlisted iframe onload", url: url });
        }
        beaconTimer = setTimeout(function () {
          if (!seenExtensionMessage) {
            finish("STRONG_NEGATIVE", {
              note: "Allowlisted page loaded; no extension postMessage before timeout."
            });
          }
        }, ALLOWLISTED_BEACON_WAIT_MS);
      };

      iframe.onerror = function () {
        finish("NEUTRAL", { error: "iframe-onerror" });
      };

      loadTimer = setTimeout(function () {
        if (!iframeLoaded) {
          finish("NEUTRAL", { error: "iframe-load-timeout" });
        } else if (!seenExtensionMessage && !settled) {
          finish("STRONG_NEGATIVE", { note: "Load wait elapsed without extension message." });
        }
      }, ALLOWLISTED_PROBE_LOAD_MS);

      iframe.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0";
      iframe.referrerPolicy = "no-referrer-when-downgrade";
      iframe.src = url;
      document.documentElement.appendChild(iframe);
      if (verboseLog) {
        verboseLog.push({ t: Date.now(), step: "allowlisted iframe src set", url: url });
      }
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function discoverChromeRuntime() {
    var diagnostic = {
      typeofChromeDefined: typeof chrome !== "undefined",
      windowChrome: !!(typeof window !== "undefined" && window.chrome),
      windowChromeRuntime: !!(
        typeof window !== "undefined" &&
        window.chrome &&
        window.chrome.runtime
      ),
      chromeRuntimeObject: !!(typeof chrome !== "undefined" && chrome && chrome.runtime),
      sendMessageAvailable: false,
      resolvedVia: null
    };
    var runtime = null;
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function"
    ) {
      runtime = chrome.runtime;
      diagnostic.sendMessageAvailable = true;
      diagnostic.resolvedVia = "chrome.runtime";
    } else if (
      typeof window !== "undefined" &&
      window.chrome &&
      window.chrome.runtime &&
      typeof window.chrome.runtime.sendMessage === "function"
    ) {
      runtime = window.chrome.runtime;
      diagnostic.sendMessageAvailable = true;
      diagnostic.resolvedVia = "window.chrome.runtime";
    }
    return { runtime: runtime, diagnostic: diagnostic };
  }

  function runtimeErrorVote(lastError, response) {
    if (response !== undefined && response !== null) {
      return "installed";
    }
    var err = String(lastError || "");
    if (err.indexOf("Could not establish connection") !== -1) {
      return "installed";
    }
    if (err.indexOf("Receiving end does not exist") !== -1) {
      return "installed";
    }
    if (err.indexOf("Extension not found") !== -1) {
      return "notInstalled";
    }
    if (err.indexOf("Invalid extension id") !== -1) {
      return "notInstalled";
    }
    return "inconclusive";
  }

  function readLastError() {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) {
        return chrome.runtime.lastError.message || "";
      }
    } catch (ignore) {}
    return "";
  }

  function oneRuntimeSend(runtime, verboseLog) {
    return new Promise(function (resolve) {
      var record = {
        lastError: "",
        response: null,
        timedOut: false,
        vote: "inconclusive"
      };
      var settled = false;

      function finish() {
        if (settled) {
          return;
        }
        settled = true;
        record.vote = runtimeErrorVote(record.lastError, record.response);
        resolve(record);
      }

      var timer = setTimeout(function () {
        record.timedOut = true;
        record.lastError = readLastError() || record.lastError;
        if (verboseLog) {
          verboseLog.push({ t: Date.now(), step: "runtime send timed out", lastError: record.lastError });
        }
        finish();
      }, RUNTIME_CALL_TIMEOUT_MS);

      try {
        runtime.sendMessage(EXTENSION_ID, { type: "ping" }, function (response) {
          clearTimeout(timer);
          record.response = response === undefined ? null : response;
          record.lastError = readLastError();
          if (verboseLog) {
            verboseLog.push({
              t: Date.now(),
              step: "runtime callback",
              lastError: record.lastError,
              hasResponse: record.response !== null
            });
          }
          finish();
        });
      } catch (err) {
        clearTimeout(timer);
        record.lastError = err && err.message ? err.message : String(err);
        finish();
      }
    });
  }

  function probeRuntimeMessage(options) {
    options = options || {};
    var verboseLog = options.verboseLog;

    return (async function () {
      var discovered = discoverChromeRuntime();
      var diagnostic = discovered.diagnostic;
      diagnostic.retriedAfterMs = null;

      if (!discovered.runtime) {
        if (verboseLog) {
          verboseLog.push({ t: Date.now(), step: "runtime not found, waiting 500ms" });
        }
        await delay(RUNTIME_RETRY_DELAY_MS);
        diagnostic.retriedAfterMs = RUNTIME_RETRY_DELAY_MS;
        discovered = discoverChromeRuntime();
        diagnostic = Object.assign(diagnostic, discovered.diagnostic);
      }

      if (!discovered.runtime) {
        diagnostic.bailedEarly = true;
        return {
          outcome: "NEUTRAL",
          strength: "NONE",
          votes: { installed: 0, notInstalled: 0, inconclusive: 0 },
          attempts: [],
          diagnostic: diagnostic,
          raw: { chromeAvailable: false, lastError: null, response: null }
        };
      }

      diagnostic.bailedEarly = false;
      diagnostic.chromeAvailable = true;
      var runtime = discovered.runtime;
      var attempts = [];

      for (var i = 0; i < RUNTIME_VOTE_COUNT; i++) {
        if (i > 0) {
          await delay(RUNTIME_VOTE_GAP_MS);
        }
        attempts.push(await oneRuntimeSend(runtime, verboseLog));
      }

      var votes = { installed: 0, notInstalled: 0, inconclusive: 0 };
      for (var j = 0; j < attempts.length; j++) {
        votes[attempts[j].vote] += 1;
      }

      var outcome = "NEUTRAL";
      var strength = "NONE";
      if (votes.installed >= 2) {
        outcome = "STRONG_POSITIVE";
        strength = "STRONG";
      } else if (votes.notInstalled >= 2) {
        outcome = "STRONG_NEGATIVE";
        strength = "STRONG";
      }

      var lastAttempt = attempts[attempts.length - 1] || { lastError: "", response: null };

      return {
        outcome: outcome,
        strength: strength,
        votes: votes,
        attempts: attempts,
        diagnostic: diagnostic,
        raw: {
          chromeAvailable: true,
          lastError: lastAttempt.lastError,
          response: lastAttempt.response,
          voteSummary: votes
        }
      };
    })();
  }

  function probeIframeAttempt(roundNumber, path, debugLog, debug) {
    return new Promise(function (resolve) {
      var iframe = document.createElement("iframe");
      var logEntry = {
        round: roundNumber,
        path: path,
        src: extUrl(path),
        onloadFired: false,
        onerrorFired: false,
        timedOut: false,
        contentHref: null,
        contentHrefError: null,
        handshakeSent: false,
        handshakeReply: false,
        handshakeOrigin: null,
        loadTimeMs: null,
        contentHrefReadable: false,
        attemptOutcome: "NEUTRAL"
      };
      var settled = false;
      var loadTimer = null;
      var handshakeTimer = null;
      var srcAssignedAt = 0;

      function debugLine(msg) {
        if (debug) {
          console.log("[eID detector debug]", msg, logEntry);
        }
      }

      function cleanup() {
        clearTimeout(loadTimer);
        clearTimeout(handshakeTimer);
        window.removeEventListener("message", onHandshake);
        iframe.onload = null;
        iframe.onerror = null;
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }

      function finish(outcome) {
        if (settled) {
          return;
        }
        settled = true;
        logEntry.attemptOutcome = outcome;
        cleanup();
        if (debugLog) {
          debugLog.push(logEntry);
        }
        debugLine("attempt finished: " + outcome);
        resolve({ outcome: outcome, log: logEntry, path: path });
      }

      function onHandshake(event) {
        if (event.origin === EXTENSION_ORIGIN) {
          logEntry.handshakeReply = true;
          logEntry.handshakeOrigin = event.origin;
          debugLine("handshake reply from extension origin");
        }
      }

      window.addEventListener("message", onHandshake);

      function waitForHandshakeThenDecide(fallbackNegative) {
        handshakeTimer = setTimeout(function () {
          if (logEntry.handshakeReply) {
            finish("STRONG_POSITIVE");
            return;
          }
          if (fallbackNegative) {
            finish("ACCESS_BLOCKED");
            return;
          }
          finish("NEUTRAL");
        }, HANDSHAKE_WAIT_MS);
      }

      function inspectLoadedFrame() {
        logEntry.onloadFired = true;
        if (srcAssignedAt) {
          logEntry.loadTimeMs = Math.round(performance.now() - srcAssignedAt);
        }
        debugLine("onload fired");

        var href = null;
        try {
          href = iframe.contentWindow.location.href;
          logEntry.contentHref = href;
          logEntry.contentHrefReadable = true;
        } catch (err) {
          logEntry.contentHrefError = err && err.message ? err.message : String(err);
          logEntry.contentHrefReadable = false;
        }

        if (href && href.indexOf(EXTENSION_ORIGIN + "/") === 0) {
          finish("STRONG_POSITIVE");
          return;
        }

        var errorPage =
          (href && href.indexOf("chrome-error:") === 0) ||
          href === "about:blank";

        try {
          logEntry.handshakeSent = true;
          iframe.contentWindow.postMessage({ eid: "ping" }, "*");
          debugLine("handshake postMessage sent");
        } catch (err) {
          logEntry.contentHrefError =
            (logEntry.contentHrefError || "") + " handshake-send:" + String(err.message || err);
        }

        if (errorPage || logEntry.contentHrefError) {
          waitForHandshakeThenDecide(true);
          return;
        }

        waitForHandshakeThenDecide(false);
      }

      iframe.style.cssText =
        "position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none";
      iframe.onload = inspectLoadedFrame;
      iframe.onerror = function () {
        logEntry.onerrorFired = true;
        if (srcAssignedAt) {
          logEntry.loadTimeMs = Math.round(performance.now() - srcAssignedAt);
        }
        debugLine("onerror fired");
        finish("ACCESS_BLOCKED");
      };

      loadTimer = setTimeout(function () {
        logEntry.timedOut = true;
        if (srcAssignedAt) {
          logEntry.loadTimeMs = Math.round(performance.now() - srcAssignedAt);
        }
        debugLine("timeout");
        finish("ACCESS_BLOCKED");
      }, IFRAME_TIMEOUT_MS);

      srcAssignedAt = performance.now();
      iframe.src = extUrl(path);
      document.documentElement.appendChild(iframe);
      debugLine("iframe src set");
    });
  }

  function runIframeRound(roundNumber, debugLog, debug) {
    return (async function () {
      var attempts = [];
      for (var i = 0; i < IFRAME_PATHS.length; i++) {
        var path = IFRAME_PATHS[i];
        var attempt = await probeIframeAttempt(roundNumber, path, debugLog, debug);
        attempts.push(attempt);
        if (attempt.outcome === "STRONG_POSITIVE") {
          return {
            round: roundNumber,
            roundOutcome: "STRONG_POSITIVE",
            winningPath: path,
            loadTimeMs: attempt.log.loadTimeMs,
            contentHrefReadable: attempt.log.contentHrefReadable,
            attempts: attempts
          };
        }
      }

      var blocked = 0;
      for (var j = 0; j < attempts.length; j++) {
        if (
          attempts[j].outcome === "ACCESS_BLOCKED" ||
          attempts[j].outcome === "STRONG_NEGATIVE"
        ) {
          blocked += 1;
        }
      }

      if (blocked === IFRAME_PATHS.length) {
        return {
          round: roundNumber,
          roundOutcome: "ACCESS_BLOCKED",
          winningPath: null,
          loadTimeMs: attempts[0] && attempts[0].log ? attempts[0].log.loadTimeMs : null,
          contentHrefReadable: false,
          attempts: attempts
        };
      }

      return {
        round: roundNumber,
        roundOutcome: "MIXED",
        winningPath: null,
        loadTimeMs: attempts[0] && attempts[0].log ? attempts[0].log.loadTimeMs : null,
        contentHrefReadable: false,
        attempts: attempts
      };
    })();
  }

  function probeIframeContent(debugLog, debug) {
    return (async function () {
      var rounds = [];
      var positiveRounds = 0;
      var blockedRounds = 0;
      var mixedRounds = 0;

      for (var r = 1; r <= IFRAME_ROUNDS; r++) {
        var round = await runIframeRound(r, debugLog, debug);
        rounds.push(round);
        if (round.roundOutcome === "STRONG_POSITIVE") {
          positiveRounds += 1;
        } else if (round.roundOutcome === "ACCESS_BLOCKED") {
          blockedRounds += 1;
        } else {
          mixedRounds += 1;
        }
      }

      var outcome = "MIXED";
      if (positiveRounds >= 2) {
        outcome = "STRONG_POSITIVE";
      } else if (blockedRounds >= 2) {
        outcome = "ACCESS_BLOCKED";
      }

      var loadTimes = [];
      for (var t = 0; t < rounds.length; t++) {
        if (typeof rounds[t].loadTimeMs === "number") {
          loadTimes.push(rounds[t].loadTimeMs);
        }
      }
      loadTimes.sort(function (a, b) {
        return a - b;
      });
      var medianLoadTimeMs =
        loadTimes.length === 0
          ? null
          : loadTimes.length % 2 === 1
            ? loadTimes[(loadTimes.length - 1) / 2]
            : Math.round((loadTimes[loadTimes.length / 2 - 1] + loadTimes[loadTimes.length / 2]) / 2);

      var timingOutcome = "NEUTRAL";
      if (medianLoadTimeMs !== null && medianLoadTimeMs < 40) {
        timingOutcome = "WEAK_POSITIVE";
      } else if (medianLoadTimeMs !== null && medianLoadTimeMs > 100) {
        timingOutcome = "WEAK_NEGATIVE";
      }

      return {
        method: "iframe-content",
        outcome: outcome,
        timingOutcome: timingOutcome,
        medianLoadTimeMs: medianLoadTimeMs,
        loadTimesMs: loadTimes,
        positiveRounds: positiveRounds,
        blockedRounds: blockedRounds,
        negativeRounds: blockedRounds,
        mixedRounds: mixedRounds,
        rounds: rounds
      };
    })();
  }

  function probeImgInformational() {
    return new Promise(function (resolve) {
      var paths = ["icon128.png", "icon64.png", "icon38.png"];
      var trials = [];
      var pending = paths.length;

      paths.forEach(function (path) {
        var img = new Image();
        var trial = { path: path, url: extUrl(path), result: "pending" };
        trials.push(trial);
        img.onload = function () {
          trial.result = "load";
          if (--pending === 0) {
            done();
          }
        };
        img.onerror = function () {
          trial.result = "error";
          if (--pending === 0) {
            done();
          }
        };
        img.src = extUrl(path);
      });

      function done() {
        resolve({
          informational: true,
          imgWorks: false,
          note: "Manifest has no web_accessible_resources; img probes are not reliable for verdict.",
          trials: trials
        });
      }
    });
  }

  function probeFetchInformational() {
    return new Promise(function (resolve) {
      var raw = { ok: false, status: null, error: null, bodyPreview: null };
      fetch(extUrl("manifest.json"))
        .then(function (response) {
          raw.status = response.status;
          raw.ok = response.ok;
          return response.text();
        })
        .then(function (text) {
          raw.bodyPreview = String(text).slice(0, 120);
          resolve({
            informational: true,
            note: "Manifest has no web_accessible_resources; fetch is not reliable for verdict.",
            raw: raw
          });
        })
        .catch(function (err) {
          raw.error = err && err.message ? err.message : String(err);
          resolve({
            informational: true,
            note: "Manifest has no web_accessible_resources; fetch is not reliable for verdict.",
            raw: raw
          });
        });
    });
  }

  function collectSecondarySignals() {
    return new Promise(function (resolve) {
      var signals = {
        domBeacon: !!document.getElementById(SIGNAL_ID),
        windowMessage: false
      };

      function onMessage(event) {
        if (event.source !== window || !event.data) {
          return;
        }
        if (EXTENSION_MESSAGE_TYPES[event.data.type]) {
          signals.windowMessage = true;
        }
      }

      window.addEventListener("message", onMessage);
      setTimeout(function () {
        window.removeEventListener("message", onMessage);
        if (!signals.domBeacon) {
          signals.domBeacon = !!document.getElementById(SIGNAL_ID);
        }
        resolve(signals);
      }, SIGNAL_TIMEOUT_MS);
    });
  }

  function runtimeSendAttemptsRan(runtimeProbe) {
    var diagnostic = (runtimeProbe && runtimeProbe.diagnostic) || {};
    if (diagnostic.bailedEarly === true) {
      return false;
    }
    return !!(runtimeProbe && runtimeProbe.raw && runtimeProbe.raw.chromeAvailable);
  }

  function iframeTimingHint(iframeProbe) {
    if (iframeProbe.medianLoadTimeMs == null) {
      return "";
    }
    return (
      " Iframe median load " +
      iframeProbe.medianLoadTimeMs +
      "ms (timing " +
      (iframeProbe.timingOutcome || "NEUTRAL") +
      "; not used alone for a verdict)."
    );
  }

  function computeVerdict(iframeProbe, runtimeProbe, signals, allowlistedProbe) {
    var primaryProbe = "runtime-message";
    var blockedAccess = iframeProbe.outcome === "ACCESS_BLOCKED";

    if (pageAllowlisted() && signals && (signals.domBeacon || signals.windowMessage)) {
      return {
        status: "INSTALLED",
        confidence: 72,
        note: "Content-script beacon on an allowlisted eID site.",
        blockedAccess: false,
        primaryProbe: "content-script-beacon"
      };
    }

    var rtStrong = runtimeProbe.strength === "STRONG";

    if (rtStrong && runtimeProbe.outcome === "STRONG_POSITIVE") {
      var confPos = iframeProbe.outcome === "STRONG_POSITIVE" ? 95 : 90;
      return {
        status: "INSTALLED",
        confidence: confPos,
        note:
          "Runtime message majority (2/3): extension present. Error: " +
          (runtimeProbe.raw.lastError || "response received") +
          ".",
        blockedAccess: blockedAccess,
        primaryProbe: primaryProbe
      };
    }

    if (rtStrong && runtimeProbe.outcome === "STRONG_NEGATIVE") {
      return {
        status: "NOT_INSTALLED",
        confidence: 90,
        note:
          "Runtime message majority (2/3): extension not found. Error: " +
          (runtimeProbe.raw.lastError || "unknown") +
          ".",
        blockedAccess: false,
        primaryProbe: primaryProbe
      };
    }

    if (allowlistedProbe && !allowlistedProbe.skipped) {
      if (allowlistedProbe.outcome === "STRONG_POSITIVE") {
        return {
          status: "INSTALLED",
          confidence: 88,
          note:
            "Extension content-script beacon received from " +
            allowlistedProbe.url +
            " (embedded allowlisted page). This extension does not expose chrome.runtime on localhost.",
          blockedAccess: blockedAccess,
          primaryProbe: "allowlisted-site-beacon"
        };
      }
      if (allowlistedProbe.outcome === "STRONG_NEGATIVE") {
        return {
          status: "NOT_INSTALLED",
          confidence: 88,
          note:
            "Allowlisted page " +
            allowlistedProbe.url +
            " loaded in a hidden iframe but no extension postMessage appeared within " +
            ALLOWLISTED_BEACON_WAIT_MS +
            "ms.",
          blockedAccess: blockedAccess,
          primaryProbe: "allowlisted-site-beacon"
        };
      }
    }

    if (iframeProbe.outcome === "STRONG_POSITIVE") {
      return {
        status: "INSTALLED",
        confidence: 95,
        note: "Iframe loaded readable chrome-extension:// content.",
        blockedAccess: false,
        primaryProbe: "iframe-content"
      };
    }

    if (
      iframeProbe.outcome === "STRONG_NEGATIVE" &&
      runtimeProbe.outcome === "STRONG_NEGATIVE"
    ) {
      return {
        status: "NOT_INSTALLED",
        confidence: 90,
        note: "Iframe and runtime both strongly negative.",
        blockedAccess: false,
        primaryProbe: "iframe-content"
      };
    }

    if (iframeProbe.outcome === "ACCESS_BLOCKED" && runtimeProbe.outcome === "NEUTRAL") {
      if (!runtimeSendAttemptsRan(runtimeProbe)) {
        var allowlistedFail = "";
        if (allowlistedProbe && !allowlistedProbe.skipped && allowlistedProbe.outcome === "NEUTRAL") {
          allowlistedFail =
            " Allowlisted-site iframe probe failed (" +
            (allowlistedProbe.error || "unknown") +
            ").";
        }
        return {
          status: "INCONCLUSIVE",
          confidence: 45,
          note:
            "chrome.runtime is not exposed on this origin (this extension has no externally_connectable for localhost)." +
            allowlistedFail +
            iframeTimingHint(iframeProbe) +
            " Needs network access to e-contract.be or test on an allowlisted HTTPS site.",
          blockedAccess: true,
          primaryProbe: "iframe-content"
        };
      }

      var votes = runtimeProbe.votes || {
        installed: 0,
        notInstalled: 0,
        inconclusive: 0
      };
      var timing = iframeProbe.timingOutcome;

      if (
        timing === "WEAK_NEGATIVE" &&
        votes.notInstalled >= 1 &&
        votes.installed === 0
      ) {
        return {
          status: "NOT_INSTALLED",
          confidence: 58,
          note:
            "Runtime did not reach 2/3 majority but leaned not installed; slow iframe loads support absent extension." +
            iframeTimingHint(iframeProbe),
          blockedAccess: true,
          primaryProbe: "runtime-message"
        };
      }

      if (
        timing === "WEAK_POSITIVE" &&
        votes.installed >= 1 &&
        votes.notInstalled === 0
      ) {
        return {
          status: "INCONCLUSIVE",
          confidence: 55,
          note:
            "Runtime saw a possible installed signal once without 2/3 majority; fast iframe loads are consistent but not sufficient alone." +
            iframeTimingHint(iframeProbe),
          blockedAccess: true,
          primaryProbe: "runtime-message"
        };
      }

      return {
        status: "INCONCLUSIVE",
        confidence: 45,
        note:
          "Iframe access blocked and runtime probe did not produce a strong majority." +
          iframeTimingHint(iframeProbe) +
          " See diagnostics.",
        blockedAccess: true,
        primaryProbe: "runtime-message"
      };
    }

    if (runtimeProbe.votes && runtimeProbe.votes.installed === 1 && !rtStrong) {
      return {
        status: "INCONCLUSIVE",
        confidence: 52,
        note: "Single runtime vote for installed without 2/3 majority.",
        blockedAccess: blockedAccess,
        primaryProbe: primaryProbe
      };
    }

    return {
      status: "INCONCLUSIVE",
      confidence: 40,
      note: "Probes did not reach a strong majority agreement.",
      blockedAccess: blockedAccess,
      primaryProbe: primaryProbe
    };
  }

  function buildDiagnostics(probes) {
    var rt = probes.runtimeMessage || {};
    var iframe = probes.iframe || {};
    var diag = rt.diagnostic || {};
    var hrefReadable = false;
    if (iframe.rounds) {
      for (var i = 0; i < iframe.rounds.length; i++) {
        if (iframe.rounds[i].contentHrefReadable) {
          hrefReadable = true;
        }
      }
    }
    var probesRan = ["iframe-content", "img (info)", "fetch (info)", "secondary-signals"];
    if (diag.bailedEarly) {
      probesRan.push("runtime-message (bailed: no chrome.runtime)");
    } else {
      probesRan.push("runtime-message (3 sends)");
    }

    return {
      chromeRuntimeAvailable: !!(diag.sendMessageAvailable || rt.raw && rt.raw.chromeAvailable),
      chromeRuntimeResolvedVia: diag.resolvedVia || "(none)",
      runtimeRetriedAfterMs: diag.retriedAfterMs,
      runtimeBailedEarly: diag.bailedEarly === true,
      runtimeErrorObserved: (rt.raw && rt.raw.lastError) || "(none)",
      runtimeVotes: rt.votes || null,
      iframeMedianLoadTimeMs:
        iframe.medianLoadTimeMs != null ? iframe.medianLoadTimeMs : "(none)",
      iframeLoadTimesMs: iframe.loadTimesMs || [],
      contentWindowHrefReadable: hrefReadable,
      iframeOutcome: iframe.outcome,
      runtimeOutcome: rt.outcome,
      runtimeStrength: rt.strength,
      probesRan: probesRan,
      iframeTimingUsedForVerdict: runtimeSendAttemptsRan(rt),
      allowlistedSiteOutcome:
        probes.allowlistedSite && !probes.allowlistedSite.skipped
          ? probes.allowlistedSite.outcome
          : "skipped"
    };
  }

  function statusLabel(status) {
    if (status === "INSTALLED") {
      return "Installed";
    }
    if (status === "NOT_INSTALLED") {
      return "Not installed";
    }
    return "Inconclusive";
  }

  function iconSpinner() {
    return (
      '<svg class="spinner-ring" viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="3" opacity="0.2"/>' +
      '<circle cx="24" cy="24" r="20" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-dasharray="32 100"/>' +
      "</svg>"
    );
  }

  function iconInstalled() {
    return (
      '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="22" fill="#ecfdf3" stroke="#15803d" stroke-width="2"/>' +
      '<path d="M15 25l7 7 13-14" fill="none" stroke="#15803d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>"
    );
  }

  function iconNotInstalled() {
    return (
      '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="22" fill="#fef2f2" stroke="#b91c1c" stroke-width="2"/>' +
      '<path d="M17 17l14 14M31 17L17 31" fill="none" stroke="#b91c1c" stroke-width="3" stroke-linecap="round"/>' +
      "</svg>"
    );
  }

  function iconInconclusive() {
    return (
      '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="22" fill="#fffbeb" stroke="#a16207" stroke-width="2"/>' +
      '<path d="M24 16v10" fill="none" stroke="#a16207" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="24" cy="32" r="1.75" fill="#a16207"/>' +
      "</svg>"
    );
  }

  function iconForStatus(status) {
    if (status === "INSTALLED") {
      return iconInstalled();
    }
    if (status === "NOT_INSTALLED") {
      return iconNotInstalled();
    }
    return iconInconclusive();
  }

  function setVerdictIcon(html, ariaLabel) {
    var el = document.getElementById("eid-verdict-icon");
    if (el) {
      el.innerHTML = html;
      if (ariaLabel) {
        el.setAttribute("aria-label", ariaLabel);
      }
    }
  }

  function badgeClassForOutcome(outcome) {
    if (!outcome) {
      return "badge-neutral";
    }
    if (outcome.indexOf("POSITIVE") !== -1) {
      return "badge-pos";
    }
    if (outcome === "ACCESS_BLOCKED") {
      return "badge-mix";
    }
    if (outcome.indexOf("NEGATIVE") !== -1) {
      return "badge-neg";
    }
    if (outcome === "MIXED") {
      return "badge-mix";
    }
    return "badge-neutral";
  }

  function renderLoading() {
    var card = document.getElementById("eid-verdict-card");
    if (!card) {
      return;
    }
    card.className = "card verdict-card verdict-inconclusive is-running";
    setVerdictIcon(iconSpinner(), "Running checks");
    setText("eid-verdict-label", "Running checks…");
    setText("eid-verdict-meta", "Primary probe: runtime message + iframe timing");
    setWidth("eid-confidence-fill", 0);
    setText(
      "eid-verdict-note",
      "Probes run in parallel. On localhost this may briefly load e-contract.be (~5–8 s)."
    );
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  function setWidth(id, pct) {
    var el = document.getElementById(id);
    if (el) {
      el.style.width = Math.max(0, Math.min(100, pct)) + "%";
    }
  }

  function renderProbeGrid(probes) {
    var grid = document.getElementById("eid-probes-grid");
    if (!grid || !probes) {
      return;
    }

    var iframe = probes.iframe || {};
    var runtime = probes.runtimeMessage || {};
    var img = probes.img || {};
    var fetchP = probes.fetch || {};
    var allowlisted = probes.allowlistedSite || {};

    var rtDetail = "—";
    if (runtime.diagnostic && !runtime.diagnostic.sendMessageAvailable) {
      rtDetail =
        "Not exposed (extension has no externally_connectable for this page)";
    } else if (runtime.raw && runtime.raw.lastError) {
      rtDetail = runtime.raw.lastError;
    } else if (runtime.votes) {
      rtDetail =
        "votes installed=" +
        runtime.votes.installed +
        " notInstalled=" +
        runtime.votes.notInstalled;
    }

    var allowlistedCard = "";
    if (!allowlisted.skipped) {
      var allowDetail = allowlisted.url || ALLOWLISTED_PROBE_URL;
      if (allowlisted.messageTypes && allowlisted.messageTypes.length) {
        allowDetail += " · " + allowlisted.messageTypes.join(", ");
      } else if (allowlisted.error) {
        allowDetail += " · " + allowlisted.error;
      } else if (allowlisted.note) {
        allowDetail += " · " + allowlisted.note;
      }
      allowlistedCard = probeCard(
        "Allowlisted site (localhost)",
        allowlisted.outcome || "NEUTRAL",
        allowDetail
      );
    }

    grid.innerHTML =
      allowlistedCard +
      probeCard(
        "Runtime message",
        runtime.outcome || "NEUTRAL",
        rtDetail
      ) +
      probeCard(
        "Iframe content + timing",
        iframe.outcome || "—",
        "median load " +
          (iframe.medianLoadTimeMs != null ? iframe.medianLoadTimeMs + "ms" : "—") +
          " · timing " +
          (iframe.timingOutcome || "NEUTRAL") +
          " · blocked " +
          (iframe.blockedRounds || 0)
      ) +
      probeCard("Image load", "INFO", img.imgWorks === false ? "Unreliable without web_accessible_resources" : "Informational") +
      probeCard(
        "Fetch manifest",
        "INFO",
        fetchP.raw && fetchP.raw.error ? fetchP.raw.error : "Informational only"
      );
  }

  function probeCard(title, outcome, detail) {
    var badgeClass =
      outcome === "INFO" ? "badge-info" : badgeClassForOutcome(String(outcome));
    var badgeText = outcome === "INFO" ? "Info" : String(outcome).replace(/_/g, " ");
    return (
      '<div class="probe-item"><h3>' +
      title +
      '</h3><span class="badge ' +
      badgeClass +
      '">' +
      badgeText +
      '</span><p class="probe-detail">' +
      (detail || "—") +
      "</p></div>"
    );
  }

  function renderDiagnostics(diagnostics, show) {
    var box = document.getElementById("eid-diagnostics");
    var list = document.getElementById("eid-diagnostics-list");
    if (!box || !list) {
      return;
    }
    if (!show || !diagnostics) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var items = [
      ["chrome.runtime available?", diagnostics.chromeRuntimeAvailable ? "yes" : "no"],
      ["resolved via", diagnostics.chromeRuntimeResolvedVia],
      ["runtime retried (ms)", String(diagnostics.runtimeRetriedAfterMs || "no")],
      ["runtime bailed early?", diagnostics.runtimeBailedEarly ? "yes" : "no"],
      ["runtime error (verbatim)", diagnostics.runtimeErrorObserved],
      ["runtime votes", diagnostics.runtimeVotes ? JSON.stringify(diagnostics.runtimeVotes) : "—"],
      ["iframe median load (ms)", String(diagnostics.iframeMedianLoadTimeMs)],
      ["iframe load times (ms)", diagnostics.iframeLoadTimesMs.join(", ") || "—"],
      ["contentWindow.location readable?", diagnostics.contentWindowHrefReadable ? "yes" : "no"],
      ["iframe outcome", diagnostics.iframeOutcome],
      ["runtime outcome / strength", diagnostics.runtimeOutcome + " / " + diagnostics.runtimeStrength],
      ["probes executed", (diagnostics.probesRan || []).join(", ")],
      [
        "iframe timing used for verdict?",
        diagnostics.iframeTimingUsedForVerdict ? "yes (runtime ran)" : "no"
      ],
      ["allowlisted site iframe", diagnostics.allowlistedSiteOutcome]
    ];
    list.innerHTML = items
      .map(function (row) {
        return "<li><strong>" + row[0] + ":</strong> " + row[1] + "</li>";
      })
      .join("");
  }

  function renderSignals(signals) {
    var dom = document.getElementById("eid-signal-dom");
    var msg = document.getElementById("eid-signal-msg");
    if (dom) {
      dom.textContent = "DOM beacon: " + (signals.domBeacon ? "seen" : "not seen");
      dom.className = "signal-pill" + (signals.domBeacon ? " on" : "");
    }
    if (msg) {
      msg.textContent = "Window message: " + (signals.windowMessage ? "seen" : "not seen");
      msg.className = "signal-pill" + (signals.windowMessage ? " on" : "");
    }
  }

  function renderReport(report, options) {
    console.log("[eID detector]", report);
    if (options && options.debug && report.debug) {
      console.log("[eID detector debug log]", report.debug);
    }
    if (options && options.verbose && report.verboseLog) {
      console.log("[eID detector verbose]", report.verboseLog);
    }

    var pre = document.getElementById("eid-detection-result");
    if (pre) {
      pre.textContent = JSON.stringify(report, null, 2);
    }

    var debugPanel = document.getElementById("eid-debug-panel");
    var debugPre = document.getElementById("eid-debug-log");
    var showDebug =
      (options && options.debug && report.debug) ||
      (document.getElementById("eid-debug-toggle") &&
        document.getElementById("eid-debug-toggle").checked &&
        report.debug);

    if (debugPre && report.debug) {
      debugPre.textContent = JSON.stringify(report.debug, null, 2);
    }
    if (debugPanel) {
      debugPanel.open = !!showDebug;
    }

    var card = document.getElementById("eid-verdict-card");
    if (card) {
      card.className = "card verdict-card verdict-" + report.status.toLowerCase();
      card.classList.remove("is-running");
    }

    setVerdictIcon(iconForStatus(report.status), statusLabel(report.status));
    setText("eid-verdict-label", statusLabel(report.status));
    setText(
      "eid-verdict-meta",
      report.confidence + "% confidence · " + (report.elapsedMs || 0) + " ms · " + report.primaryProbe
    );
    setWidth("eid-confidence-fill", report.confidence);
    setText("eid-verdict-note", report.note || "");

    renderProbeGrid(report.probes);
    renderSignals(report.signals || { domBeacon: false, windowMessage: false });

    var localhostNote = document.getElementById("eid-localhost-note");
    if (localhostNote) {
      localhostNote.hidden = !report.blockedAccess;
    }

    renderDiagnostics(
      report.diagnostics,
      report.status === "INCONCLUSIVE" || (options && options.verbose)
    );

    var verbosePanel = document.getElementById("eid-verbose-panel");
    var verbosePre = document.getElementById("eid-verbose-log");
    if (verbosePre && report.verboseLog) {
      verbosePre.textContent = JSON.stringify(report.verboseLog, null, 2);
    }
    if (verbosePanel) {
      verbosePanel.open = !!(options && options.verbose && report.verboseLog);
    }

    var banner = document.getElementById("eid-verdict-banner");
    if (banner) {
      banner.className = "verdict-banner verdict-" + report.status.toLowerCase();
      banner.textContent =
        statusLabel(report.status) + " — " + report.confidence + "% confidence";
    }
  }

  global.renderEidLoading = renderLoading;

  function runEidDetector(options) {
    options = options || {};
    var debug = !!options.debug;
    var verbose = !!options.verbose;
    var debugLog = debug ? [] : null;
    var verboseLog = verbose || debug ? [] : null;
    var started = performance.now();

    if (verboseLog) {
      verboseLog.push({ t: Date.now(), step: "detection started", page: location.href });
    }

    renderLoading();

    var runtimeOpts = { verboseLog: verboseLog };

    return Promise.all([
      probeIframeContent(debugLog, debug),
      probeRuntimeMessage(runtimeOpts),
      probeImgInformational(),
      probeFetchInformational(),
      collectSecondarySignals(),
      probeAllowlistedSiteIframe(runtimeOpts)
    ]).then(function (parts) {
      var iframeProbe = parts[0];
      var runtimeProbe = parts[1];
      var signals = parts[4];
      var allowlistedProbe = parts[5];
      var probes = {
        iframe: iframeProbe,
        runtimeMessage: runtimeProbe,
        img: parts[2],
        fetch: parts[3],
        allowlistedSite: allowlistedProbe
      };
      var verdict = computeVerdict(iframeProbe, runtimeProbe, signals, allowlistedProbe);
      var diagnostics = buildDiagnostics(probes);

      if (verboseLog) {
        verboseLog.push({ t: Date.now(), step: "verdict", verdict: verdict, diagnostics: diagnostics });
      }

      var report = {
        status: verdict.status,
        confidence: verdict.confidence,
        blockedAccess: verdict.blockedAccess === true,
        primaryProbe: verdict.primaryProbe,
        extensionId: EXTENSION_ID,
        extensionName: "eID Chrome Extension",
        inspectedManifestVersion: "1.0.3",
        page: location.href,
        pageAllowlisted: pageAllowlisted(),
        allowlistedOrigin: pageAllowlisted(),
        probes: probes,
        diagnostics: diagnostics,
        signals: signals,
        note: verdict.note,
        elapsedMs: Math.round(performance.now() - started)
      };

      if (debug) {
        report.debug = debugLog;
      }
      if (verboseLog) {
        report.verboseLog = verboseLog;
      }

      renderReport(report, options);
      return report;
    });
  }

  global.runEidDetector = runEidDetector;

  if (global.document && global.document.getElementById("eid-detection-result")) {
    var toggle = global.document.getElementById("eid-debug-toggle");
    var verboseToggle = global.document.getElementById("eid-verbose-toggle");
    runEidDetector({
      debug: !!(toggle && toggle.checked),
      verbose: !!(verboseToggle && verboseToggle.checked)
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
