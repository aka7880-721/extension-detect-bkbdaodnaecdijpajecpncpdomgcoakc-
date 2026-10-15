# eID Chrome Extension detection

Plain-JavaScript proof of concept for extension `bkbdaodnaecdijpajecpncpdomgcoakc` (**eID Chrome Extension**, e-Contract.be), runnable from `http://localhost:3000` or the DevTools console.

## Why iframe content inspection

Version **1.0.3** has **no `web_accessible_resources`**. That means:

- `<img src="chrome-extension://…/icon128.png">` usually **errors** even when the extension is installed.
- `fetch(chrome-extension://…/manifest.json)` usually **fails** (blocked/CORS).

Those probes are kept **informational only** (`img.imgWorks: false`).

A naïve iframe **`onload`** probe is also unreliable: Chrome can show **`chrome-error://`** inside the frame and still fire `onload`.

The **primary** method (**Probe A2 — iframe content**) loads manifest icon paths in a hidden iframe, then:

1. Reads `iframe.contentWindow.location.href` when allowed.
2. Treats `chrome-extension://bkbdaodnaecdijpajecpncpdomgcoakc/…` as **strong positive**.
3. Treats `chrome-error://`, `about:blank`, `onerror`, timeout, or failed **postMessage handshake** (`{ eid: "ping" }`) as **strong negative**.
4. Runs **3 rounds** over paths `icon128.png`, `icon64.png`, `icon38.png`, `manifest.json` (first winning path per round).
5. Requires **2/3 round agreement** for a strong iframe verdict.

## Verdict logic

| Primary iframe (A2) | Runtime message (B) | Result |
|---|---|---|
| 2/3 rounds **strong positive** | (any) | **INSTALLED**, confidence **85+** |
| 2/3 rounds **strong negative** | (any) | **NOT_INSTALLED**, confidence **85+** |
| Mixed rounds | “Could not establish connection” / response | **INSTALLED** (~68–75%) — extension likely present, no external listener |
| Mixed rounds | “Extension not found” / similar | **NOT_INSTALLED** (~68%) |
| Mixed rounds | `chrome.runtime` unavailable / neutral | **INCONCLUSIVE** |

**Probe B:** `chrome.runtime.sendMessage(ID, { type: "ping" })` with 600ms timeout when `chrome.runtime` exists.

**Secondary signals** (forgeable, not verdict drivers): `signals.domBeacon`, `signals.windowMessage`.

## Run locally (Windows)

**Double-click `run.bat`** in this folder. You do **not** need Python pre-installed.

1. If `py` / `python` is already on PATH, that is used.
2. Otherwise **`run.bat` downloads portable Python 3.12** once into `.runtime\python` (internet required on first run only), then starts the server.
3. If the download fails, **`serve.ps1`** serves the folder with PowerShell (no Python).

Then open the URL shown in the black console window in **Google Chrome** (usually `http://localhost:3000/`; if port 3000 is busy, **`run.bat` uses 3001–3010** automatically).

**Leave the console window open** while you test. If the server fails, the window stays open with an error instead of closing immediately.

Manual alternative:

```powershell
py -m http.server 3000
```

- Banner: green **INSTALLED**, red **NOT_INSTALLED**, yellow **INCONCLUSIVE** + confidence %
- **Re-run** — normal detection
- **Debug** — `runEidDetector({ debug: true })` and per-iframe-attempt log
- Checkbox **Show debug log** — keeps the debug `<pre>` visible

Console: paste `detector.js` or call `runEidDetector({ debug: true })`.

## Output shape

```json
{
  "status": "INSTALLED | NOT_INSTALLED | INCONCLUSIVE",
  "confidence": 0,
  "primaryProbe": "iframe-content",
  "extensionId": "bkbdaodnaecdijpajecpncpdomgcoakc",
  "page": "http://localhost:3000/",
  "pageAllowlisted": false,
  "probes": {
    "iframe": { "outcome": "...", "rounds": [] },
    "runtimeMessage": { "outcome": "...", "raw": {} },
    "img": { "informational": true, "imgWorks": false, "trials": [] },
    "fetch": { "informational": true, "raw": {} }
  },
  "signals": { "domBeacon": false, "windowMessage": false },
  "note": "...",
  "debug": []
}
```

`debug` is present only when `debug: true`.

## Manifest icons (for probes)

```json
"icons": {
  "64": "icon64.png",
  "128": "icon128.png",
  "38": "icon38.png"
}
```

## Test matrix

Fill in on your machine after real Chrome runs (extension installed/uninstalled via `chrome://extensions`).

| Extension state | Page | Expected |
|---|---|---|
| Installed, enabled | `http://localhost:3000` | **INSTALLED** if 2/3 iframe rounds see `chrome-extension://…`; else runtime tiebreaker |
| Not installed | `http://localhost:3000` | **NOT_INSTALLED** if 2/3 iframe rounds see `chrome-error://` / failed handshake |
| Installed, enabled | Allowlisted HTTPS (e.g. `https://www.e-contract.be/`) | Same primary probes; `signals` may show content-script beacon |
| Not installed | Allowlisted HTTPS | **NOT_INSTALLED** when iframe + runtime agree |

### Workspace test record

Chrome `155.0.8059.40`, headless, fresh profile, extension **not** installed, `http://localhost:3000/`:

| Case | Result |
|---|---|
| Not installed + localhost | **NOT_INSTALLED** — **90%** confidence. Primary iframe-content: 3/3 rounds **STRONG_NEGATIVE** (`chrome-error://` / failed handshake on manifest icon paths). |
| Installed + localhost | NOT TESTED (extension not in workspace profiles) |
| Installed / not installed + allowlisted site | NOT TESTED |

## Files

- `detector.js` — `runEidDetector({ debug?: boolean })`
- `index.html` — banner, Re-run, Debug, debug log
- `README.md` — this document
