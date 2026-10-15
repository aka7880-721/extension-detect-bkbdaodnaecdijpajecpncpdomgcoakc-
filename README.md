# eID Chrome Extension detection

Plain-JavaScript proof of concept for extension `bkbdaodnaecdijpajecpncpdomgcoakc` (**eID Chrome Extension**, e-Contract.be), runnable from `http://localhost:3000` or the DevTools console.

## Primary signal on localhost: allowlisted-site iframe

The eID extension (manifest **1.0.3**) has **no `externally_connectable`**, so Chrome does **not** inject `chrome.runtime` into `http://127.0.0.1` / `localhost` pages. Runtime error-string probing only works when the extension (or Chrome policy) exposes that API to your origin.

On **localhost**, the detector instead embeds **`https://www.e-contract.be/`** in a hidden iframe. The extension’s **content script** runs on that origin and broadcasts `postMessage` types such as `eid-chrome-extension`. The parent page accepts messages only when:

- `event.origin` matches an allowlisted eID host, and  
- `event.source` is the iframe’s `contentWindow`.

| Allowlisted iframe | Verdict |
|---|---|
| Extension message seen | **INSTALLED** (~88%) |
| Page loads, no message within ~4.5 s | **NOT_INSTALLED** (~88%) |
| Iframe cannot load (offline / blocked) | **INCONCLUSIVE** |

Requires network access to e-contract.be on first run from localhost.

## Runtime message (when API is exposed)

If `chrome.runtime.sendMessage` is available on the page, the detector:

1. Discovers `chrome.runtime` via `chrome.runtime` and `window.chrome.runtime`, with a **500 ms retry** if injection is delayed.
2. Sends `{ type: "ping" }` to the extension id **three times** (100 ms apart), **400 ms timeout** per call.
3. Classifies each attempt from `chrome.runtime.lastError.message` and optional response:
   - **Installed:** “Could not establish connection”, “Receiving end does not exist”, or a non-null response (external listener).
   - **Not installed:** “Extension not found”, “Invalid extension id”.
4. **2/3 majority** → **STRONG** runtime outcome (90% confidence when it drives the verdict).

If `chrome.runtime` is still missing after retry, runtime stays **NEUTRAL** (diagnostics show why).

## Secondary: iframe content + load timing

Version **1.0.3** has **no `web_accessible_resources`**, so img/fetch probes are **informational only**.

Iframe probe (3 rounds):

- Tries to read `contentWindow.location.href` (often **ACCESS_BLOCKED** on localhost → `chrome-error://`).
- Records **load time** from `src` assignment to `onload` per round.
- **Median &lt; 40 ms** → weak positive timing; **&gt; 100 ms** → weak negative (recorded in diagnostics only).
- Timing **never** declares **Installed** by itself. It may slightly support a verdict only when **`chrome.runtime` ran** and runtime votes already lean the same way (no 2/3 majority). If runtime is unavailable on the page, result stays **INCONCLUSIVE** even when loads are fast.

## Verdict priority

| Order | Condition | Result |
|---|---|---|
| 1 | Runtime **STRONG** positive | **INSTALLED** (~90–95%) |
| 2 | Runtime **STRONG** negative | **NOT_INSTALLED** (~90%) |
| 3 | Iframe **STRONG_POSITIVE** | **INSTALLED** (95%) |
| 4 | Iframe **STRONG_NEGATIVE** + runtime **STRONG_NEGATIVE** | **NOT_INSTALLED** (90%) |
| 5 | Iframe **ACCESS_BLOCKED** + runtime **NEUTRAL** / unavailable | **INCONCLUSIVE** (45%); optional weak hint if runtime ran but split votes |
| — | Runtime **STRONG** vs conflicting iframe | **Runtime wins** |

Allowlisted HTTPS eID sites: forgeable **DOM / postMessage** beacons can suggest installed (~72%) but are not used on localhost.

## Run locally (Windows)

**Double-click `run.bat`** in this folder. You do **not** need Python pre-installed.

1. If `py` / `python` is on PATH, that is used.
2. Otherwise portable Python 3.12 is downloaded once into `.runtime\python`.
3. If download fails, **`serve.ps1`** serves the folder with PowerShell.

Open the URL from the console in **Google Chrome** (`http://127.0.0.1:3000/` or next free port **3001–3010**). Leave the console window open while testing.

Manual alternative:

```powershell
py -m http.server 3000 --bind 127.0.0.1
```

### UI

- Verdict card with confidence and primary probe name
- **Re-run** / **Run with debug** (iframe attempt log)
- **Verbose** — timestamped steps in console and “Verbose step log” panel
- **Diagnostic** box when result is **INCONCLUSIVE** (or when verbose is on): runtime availability, verbatim error, iframe load times, probes run

Console API:

```js
runEidDetector({ debug: true, verbose: true })
```

## Output shape

```json
{
  "status": "INSTALLED | NOT_INSTALLED | INCONCLUSIVE",
  "confidence": 0,
  "primaryProbe": "runtime-message | iframe-content | iframe-timing | content-script-beacon",
  "diagnostics": { "chromeRuntimeAvailable": true, "runtimeErrorObserved": "...", "iframeLoadTimesMs": [] },
  "probes": {
    "runtimeMessage": { "outcome": "STRONG_POSITIVE", "strength": "STRONG", "diagnostic": {}, "votes": {} },
    "iframe": { "outcome": "ACCESS_BLOCKED", "medianLoadTimeMs": 12, "timingOutcome": "WEAK_POSITIVE" }
  },
  "verboseLog": []
}
```

## Test matrix

Fill in on your machine (extension installed/uninstalled via `chrome://extensions`).

| Extension state | Page | Expected |
|---|---|---|
| Installed, enabled | `http://localhost:3000` | **INSTALLED** if allowlisted iframe sees content-script `postMessage` |
| Not installed | `http://localhost:3000` | **NOT_INSTALLED** if allowlisted iframe loads with no extension message |
| Installed, enabled | Allowlisted HTTPS (e.g. `https://www.e-contract.be/`) | Runtime + iframe; optional content-script signals |
| Not installed | Allowlisted HTTPS | **NOT_INSTALLED** when runtime strong negative |

### Workspace test record

Automated runs may use a profile **without** the extension. **Installed + localhost** must be verified on a machine where the eID extension is enabled; check the Diagnostic box if the verdict is inconclusive.

## Files

- `detector.js` — `runEidDetector({ debug?, verbose? })`
- `index.html` — harness, diagnostics, verbose log
- `run.bat` / `setup-python.ps1` / `serve.ps1` — local server on Windows
- `README.md` — this document
