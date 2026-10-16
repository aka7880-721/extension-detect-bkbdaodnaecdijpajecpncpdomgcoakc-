# eID Extension Detector

Local **JavaScript** proof of concept: detect the Belgian **eID Chrome Extension** (`bkbdaodnaecdijpajecpncpdomgcoakc`) in the Chrome profile the client activates before running the demo.

## Structure

```
public/          Web client (HTML, CSS, JS)
server/          Local HTTP server + profile check (Windows)
var/             Runtime output (gitignored)
run.bat          One-click launcher (client)
package.json     npm-style metadata & scripts
```

## Client use

1. Click the Chrome profile to test.  
2. Double-click **`run.bat`**.  
3. Read **Installed** / **Not installed** on the page (~2 s).

## Developer use

```bash
npm run snapshot   # capture active Chrome profile
npm start          # same as run.bat server (port 3000)
```

See **[TESTING.md](TESTING.md)**.
