# two·booth 📸♥

A tiny online photobooth for long-distance couples. Take a photo strip, send it
across the distance, put both strips together — or step into the **live booth**
and take every photo together in real time.

## Features

- **Four booth designs** — classic, noir (b&w film), blush (soft pink), retro (warm paper)
- **Photo strips** — 3 or 4 shots with countdown, flash, caption, and date; download or share
- **Live together mode** — one of you hosts and gets a 4-letter code, the other
  joins with it. You see each other side by side and every photo captures you
  both at the same moment. Both of you get the same strip.
- **Fun filters** — dog, bunny, shades, mustache, heart crown, and crown; each of
  you picks your own, sees each other's live, and both land on the strip
- **Combine mode** — merge two separately-taken strips into one couple frame
- **Private by design** — no accounts, no backend, photos never leave your devices.
  Live mode uses a direct peer-to-peer WebRTC connection (PeerJS is used only to
  exchange the connection code).
- Minimalist, fully responsive, works on phones, tablets, and desktops

## Running it

It's a static site — any web server works:

```
python -m http.server 8420
```

then open http://localhost:8420.

> **Note:** browsers only allow camera access over **HTTPS** (or localhost).
> To use it together from two places, host it somewhere with HTTPS —
> GitHub Pages, Netlify, or Vercel all work for free.

## If live mode won't connect (strict mobile networks)

Live together mode connects your two devices directly. On some mobile carrier
networks a direct connection is blocked, and the join gets stuck on
"still trying…". The fix is a TURN relay — free for this app's usage:

1. Create a free account at <https://www.metered.ca/stun-turn> (20 GB/month free —
   far more than a couple ever needs; the relay only engages when a direct
   connection is impossible).
2. In the Metered dashboard, copy your **credentials URL** — it looks like
   `https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOURKEY`.
3. Open `app.js`, find `TURN_FETCH_URL = ""` near the "optional TURN relay"
   comment, and paste the URL between the quotes.
4. Commit and push — done. The relay traffic is encrypted end-to-end; the relay
   can't see your video, and photos still never leave your devices.

## Stack

Plain HTML, CSS, and JavaScript. No build step. [PeerJS](https://peerjs.com)
(from CDN) for the live together mode.

---

made with ♥ for long-distance love
