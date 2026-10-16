/**
 * eID Chrome Extension detector — client runtime
 * Extension ID: bkbdaodnaecdijpajecpncpdomgcoakc
 */
(function (global) {
  "use strict";

  var EXTENSION_ID = "bkbdaodnaecdijpajecpncpdomgcoakc";
  var POLL_MS = 200;
  var TIMEOUT_MS = 20000;
  var FIRST_DELAY_MS = 600;

  function getExpectedRunId() {
    try {
      return new URLSearchParams(global.location.search).get("run") || "";
    } catch (e) {
      return "";
    }
  }

  function fetchResult(expectedRun) {
    var q =
      "run=" +
      encodeURIComponent(expectedRun) +
      "&t=" +
      Date.now() +
      "&r=" +
      Math.random().toString(36).slice(2);
    return fetch("/api/result.json?" + q, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function normalizeReport(raw, expectedRun) {
    if (!raw || !raw.status) return null;
    if (expectedRun && raw.runId && raw.runId !== expectedRun) return null;
    if (raw.status !== "INSTALLED" && raw.status !== "NOT_INSTALLED" && raw.status !== "INCONCLUSIVE") {
      return null;
    }
    return {
      status: raw.status,
      confidence: raw.confidence != null ? raw.confidence : 0,
      note: raw.note || "",
      primaryProbe: raw.primaryProbe || "run-profile",
      extensionId: raw.extensionId || EXTENSION_ID,
      chromeProfile: raw.chromeProfile || "",
      runId: raw.runId || "",
      page: global.location.href,
      elapsedMs: raw.elapsedMs != null ? raw.elapsedMs : 0,
      probes: raw
    };
  }

  function statusLabel(status) {
    if (status === "INSTALLED") return "Installed";
    if (status === "NOT_INSTALLED") return "Not installed";
    return "Inconclusive";
  }

  function iconSpinner() {
    return (
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="9" opacity="0.2"/>' +
      '<path class="spin" d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/></svg>'
    );
  }

  function iconForStatus(status) {
    if (status === "INSTALLED") {
      return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>';
    }
    if (status === "NOT_INSTALLED") {
      return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    }
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01"/></svg>';
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  function setWidth(id, pct) {
    var el = $(id);
    if (el) el.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  function renderRunning() {
    var card = $("eid-verdict-card");
    if (card) card.className = "verdict verdict--pending is-busy";
    var icon = $("eid-verdict-icon");
    if (icon) icon.innerHTML = iconSpinner();
    setText("eid-verdict-label", "Analyzing…");
    setText("eid-verdict-meta", "Extension " + EXTENSION_ID.slice(0, 8) + "…");
    setWidth("eid-confidence-fill", 18);
    setText("eid-verdict-note", "Reading active Chrome profile for this run…");
    setText("eid-profile-chip", "…");
  }

  function renderReport(report) {
    var card = $("eid-verdict-card");
    var mod = report.status === "INSTALLED" ? "ok" : report.status === "NOT_INSTALLED" ? "no" : "warn";
    if (card) {
      card.className = "verdict verdict--" + mod;
      card.classList.remove("is-busy");
    }
    var icon = $("eid-verdict-icon");
    if (icon) icon.innerHTML = iconForStatus(report.status);
    setText("eid-verdict-label", statusLabel(report.status));
    setText("eid-verdict-meta", report.confidence + "% confidence · " + report.elapsedMs + " ms");
    setWidth("eid-confidence-fill", report.confidence);
    setText("eid-verdict-note", report.note || "");
    setText("eid-profile-chip", report.chromeProfile || "—");
    var pre = $("eid-detection-result");
    if (pre) pre.textContent = JSON.stringify(report, null, 2);
  }

  function pollForResult(started, expectedRun) {
    return fetchResult(expectedRun)
      .then(function (raw) {
        var report = normalizeReport(raw, expectedRun);
        if (!report) throw new Error("stale");
        report.elapsedMs = Math.max(report.elapsedMs, Math.round(performance.now() - started));
        return report;
      })
      .catch(function () {
        if (performance.now() - started >= TIMEOUT_MS) {
          return {
            status: "INCONCLUSIVE",
            confidence: 0,
            note: "Timed out. Click Chrome profile, run run.bat again (close old tabs).",
            primaryProbe: "run-profile",
            extensionId: EXTENSION_ID,
            chromeProfile: "",
            runId: expectedRun,
            page: global.location.href,
            elapsedMs: Math.round(performance.now() - started),
            probes: {}
          };
        }
        return new Promise(function (resolve) {
          global.setTimeout(function () {
            resolve(pollForResult(started, expectedRun));
          }, POLL_MS);
        });
      });
  }

  function run() {
    var expectedRun = getExpectedRunId();
    if (!expectedRun) {
      renderRunning();
      setText("eid-verdict-label", "Inconclusive");
      setText(
        "eid-verdict-note",
        "Open this page from run.bat (URL must include ?run=…). Close bookmarked old tabs."
      );
      return Promise.resolve();
    }

    var started = performance.now();
    renderRunning();
    return new Promise(function (resolve) {
      global.setTimeout(function () {
        resolve(pollForResult(started, expectedRun).then(renderReport));
      }, FIRST_DELAY_MS);
    });
  }

  global.runEidDetector = run;

  if (document.getElementById("eid-verdict-card")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
