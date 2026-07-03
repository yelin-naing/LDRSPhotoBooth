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

## Stack

Plain HTML, CSS, and JavaScript. No build step. [PeerJS](https://peerjs.com)
(from CDN) for the live together mode.

---

made with ♥ for long-distance love
