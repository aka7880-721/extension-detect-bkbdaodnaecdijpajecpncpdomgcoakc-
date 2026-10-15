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
  var RUNTIME_TIMEOUT_MS = 600;
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

  function classifyRuntimeError(message) {
    var msg = String(message || "");
    var lower = msg.toLowerCase();
    if (!msg) {
      return "NEUTRAL";
    }
    if (
      lower.indexOf("could not establish connection") !== -1 ||
      lower.indexOf("receiving end does not exist") !== -1
    ) {
      return "LEAN_INSTALLED";
    }
    if (
      lower.indexOf("extension not found") !== -1 ||
      lower.indexOf("invalid extension id") !== -1
    ) {
      return "LEAN_NOT_INSTALLED";
    }
    return "NEUTRAL";
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
        attemptOutcome: "NEUTRAL"
      };
      var settled = false;
      var loadTimer = null;
      var handshakeTimer = null;

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
            finish("STRONG_NEGATIVE");
            return;
          }
          finish("NEUTRAL");
        }, HANDSHAKE_WAIT_MS);
      }

      function inspectLoadedFrame() {
        logEntry.onloadFired = true;
        debugLine("onload fired");

        var href = null;
        try {
          href = iframe.contentWindow.location.href;
          logEntry.contentHref = href;
        } catch (err) {
          logEntry.contentHrefError = err && err.message ? err.message : String(err);
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
        debugLine("onerror fired");
        finish("STRONG_NEGATIVE");
      };

      loadTimer = setTimeout(function () {
        logEntry.timedOut = true;
        debugLine("timeout");
        finish("STRONG_NEGATIVE");
      }, IFRAME_TIMEOUT_MS);

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
            attempts: attempts
          };
        }
      }

      var strongNeg = 0;
      for (var j = 0; j < attempts.length; j++) {
        if (attempts[j].outcome === "STRONG_NEGATIVE") {
          strongNeg += 1;
        }
      }

      if (strongNeg === IFRAME_PATHS.length) {
        return {
          round: roundNumber,
          roundOutcome: "STRONG_NEGATIVE",
          winningPath: null,
          attempts: attempts
        };
      }

      return {
        round: roundNumber,
        roundOutcome: "MIXED",
        winningPath: null,
        attempts: attempts
      };
    })();
  }

  function probeIframeContent(debugLog, debug) {
    return (async function () {
      var rounds = [];
      var positiveRounds = 0;
      var negativeRounds = 0;
      var mixedRounds = 0;

      for (var r = 1; r <= IFRAME_ROUNDS; r++) {
        var round = await runIframeRound(r, debugLog, debug);
        rounds.push(round);
        if (round.roundOutcome === "STRONG_POSITIVE") {
          positiveRounds += 1;
        } else if (round.roundOutcome === "STRONG_NEGATIVE") {
          negativeRounds += 1;
        } else {
          mixedRounds += 1;
        }
      }

      var outcome = "MIXED";
      if (positiveRounds >= 2) {
        outcome = "STRONG_POSITIVE";
      } else if (negativeRounds >= 2) {
        outcome = "STRONG_NEGATIVE";
      }

      return {
        method: "iframe-content",
        outcome: outcome,
        positiveRounds: positiveRounds,
        negativeRounds: negativeRounds,
        mixedRounds: mixedRounds,
        rounds: rounds
      };
    })();
  }

  function probeRuntimeMessage() {
    return new Promise(function (resolve) {
      var raw = {
        chromeAvailable: false,
        lastError: null,
        response: null,
        timedOut: false,
        lean: "NEUTRAL"
      };

      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        typeof chrome.runtime.sendMessage !== "function"
      ) {
        resolve({ outcome: "NEUTRAL", raw: raw });
        return;
      }

      raw.chromeAvailable = true;
      var settled = false;

      function finish(outcome) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ outcome: outcome, raw: raw });
      }

      var timer = setTimeout(function () {
        raw.timedOut = true;
        finish("NEUTRAL");
      }, RUNTIME_TIMEOUT_MS);

      try {
        chrome.runtime.sendMessage(EXTENSION_ID, { type: "ping" }, function (response) {
          raw.response = response === undefined ? null : response;
          raw.lastError =
            chrome.runtime.lastError && chrome.runtime.lastError.message
              ? chrome.runtime.lastError.message
              : null;

          if (raw.response !== null && typeof raw.response !== "undefined") {
            raw.lean = "LEAN_INSTALLED";
            finish("STRONG_POSITIVE");
            return;
          }

          var lean = classifyRuntimeError(raw.lastError);
          raw.lean = lean;
          if (lean === "LEAN_INSTALLED") {
            finish("WEAK_POSITIVE");
            return;
          }
          if (lean === "LEAN_NOT_INSTALLED") {
            finish("STRONG_NEGATIVE");
            return;
          }
          finish("NEUTRAL");
        });
      } catch (err) {
        raw.lastError = err && err.message ? err.message : String(err);
        raw.lean = classifyRuntimeError(raw.lastError);
        finish("NEUTRAL");
      }
    });
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

  function computeVerdict(iframeProbe, runtimeProbe) {
    var status = "INCONCLUSIVE";
    var confidence = 40;
    var note = "Primary iframe probe and runtime tiebreaker did not agree.";

    if (iframeProbe.outcome === "STRONG_POSITIVE") {
      status = "INSTALLED";
      confidence = Math.min(100, 85 + (iframeProbe.positiveRounds - 2) * 5);
      note =
        "Iframe content inspection: " +
        iframeProbe.positiveRounds +
        "/" +
        IFRAME_ROUNDS +
        " rounds saw chrome-extension:// content.";
      return { status: status, confidence: confidence, note: note };
    }

    if (iframeProbe.outcome === "STRONG_NEGATIVE") {
      status = "NOT_INSTALLED";
      confidence = Math.min(100, 85 + (iframeProbe.negativeRounds - 2) * 5);
      note =
        "Iframe content inspection: " +
        iframeProbe.negativeRounds +
        "/" +
        IFRAME_ROUNDS +
        " rounds saw chrome-error or failed handshake.";
      return { status: status, confidence: confidence, note: note };
    }

    var rt = runtimeProbe.outcome;
    var lean = runtimeProbe.raw && runtimeProbe.raw.lean;

    if (rt === "STRONG_POSITIVE" || rt === "WEAK_POSITIVE" || lean === "LEAN_INSTALLED") {
      status = "INSTALLED";
      confidence = rt === "STRONG_POSITIVE" ? 75 : 68;
      note =
        "Iframe rounds mixed; runtime message suggests the extension is present" +
        (runtimeProbe.raw.lastError ? " (" + runtimeProbe.raw.lastError + ")." : ".");
      return { status: status, confidence: confidence, note: note };
    }

    if (rt === "STRONG_NEGATIVE" || lean === "LEAN_NOT_INSTALLED") {
      status = "NOT_INSTALLED";
      confidence = 68;
      note =
        "Iframe rounds mixed; runtime message suggests the extension is absent" +
        (runtimeProbe.raw.lastError ? " (" + runtimeProbe.raw.lastError + ")." : ".");
      return { status: status, confidence: confidence, note: note };
    }

    if (!runtimeProbe.raw.chromeAvailable) {
      note = "Iframe rounds mixed and chrome.runtime is unavailable on this page.";
    }

    return { status: status, confidence: confidence, note: note };
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
    setText("eid-verdict-meta", "Primary probe: iframe content inspection");
    setWidth("eid-confidence-fill", 0);
    setText("eid-verdict-note", "Probes run in parallel. This takes about 2–4 seconds.");
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

    grid.innerHTML =
      probeCard(
        "Iframe (primary)",
        iframe.outcome || "—",
        "Rounds: +" +
          (iframe.positiveRounds || 0) +
          " / −" +
          (iframe.negativeRounds || 0) +
          (iframe.mixedRounds ? " (mixed " + iframe.mixedRounds + ")" : "")
      ) +
      probeCard(
        "Runtime message",
        runtime.outcome || "NEUTRAL",
        runtime.raw && runtime.raw.lastError
          ? runtime.raw.lastError
          : runtime.raw && runtime.raw.chromeAvailable
            ? "chrome.runtime available"
            : "chrome.runtime not exposed on this page"
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
    var debugLog = debug ? [] : null;
    var started = performance.now();

    renderLoading();

    return Promise.all([
      probeIframeContent(debugLog, debug),
      probeRuntimeMessage(),
      probeImgInformational(),
      probeFetchInformational(),
      collectSecondarySignals()
    ]).then(function (parts) {
      var iframeProbe = parts[0];
      var runtimeProbe = parts[1];
      var verdict = computeVerdict(iframeProbe, runtimeProbe);

      var report = {
        status: verdict.status,
        confidence: verdict.confidence,
        primaryProbe: "iframe-content",
        extensionId: EXTENSION_ID,
        extensionName: "eID Chrome Extension",
        inspectedManifestVersion: "1.0.3",
        page: location.href,
        pageAllowlisted: pageAllowlisted(),
        allowlistedOrigin: pageAllowlisted(),
        probes: {
          iframe: iframeProbe,
          runtimeMessage: runtimeProbe,
          img: parts[2],
          fetch: parts[3]
        },
        signals: parts[4],
        note: verdict.note,
        elapsedMs: Math.round(performance.now() - started)
      };

      if (debug) {
        report.debug = debugLog;
      }

      renderReport(report, options);
      return report;
    });
  }

  global.runEidDetector = runEidDetector;

  if (global.document && global.document.getElementById("eid-detection-result")) {
    var toggle = global.document.getElementById("eid-debug-toggle");
    runEidDetector({ debug: !!(toggle && toggle.checked) });
  }
})(typeof window !== "undefined" ? window : globalThis);
