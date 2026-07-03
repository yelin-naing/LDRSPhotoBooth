/* two·booth — a tiny photobooth for long-distance couples.
   Everything runs in the browser; no photo ever leaves the device. */

(() => {
  "use strict";

  // ---------- state ----------
  const state = {
    theme: "classic",
    shots: 3,
    filter: "none",
    facing: "user",
    stream: null,
    capturing: false,
    lastStripUrl: null, // dataURL of the latest composed strip
    imgA: null,         // Image for together mode
    imgB: null,
  };

  // live together (duo) session — WebRTC via PeerJS, host is always the left half
  const DUO_PREFIX = "twobooth-";
  const duo = {
    active: false,
    role: null, // 'host' | 'guest'
    code: null,
    peer: null,
    conn: null,
    call: null,
    pendingCall: null,
    connOpen: false,
    remoteReady: false,
    remoteCamTrouble: false,
    remoteFilter: "none",
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- themes ----------
  // Each theme composes a strip on canvas: photo 640x480, custom chrome around it.
  const THEMES = {
    classic: {
      bg: "#ffffff", fg: "#1c1a17", sub: "#9a948a",
      pad: 46, gap: 26, footerH: 128,
      filter: "none",
      captionFont: '500 30px "Inter", sans-serif',
      dateFont: '400 21px "Inter", sans-serif',
      decorate(ctx, w, h) {
        ctx.strokeStyle = "#e5e1d8";
        ctx.lineWidth = 2;
        ctx.strokeRect(16, 16, w - 32, h - 32);
      },
    },
    noir: {
      bg: "#141416", fg: "#f2f0ec", sub: "#8a8a92",
      pad: 74, gap: 30, footerH: 132,
      filter: "grayscale(1) contrast(1.08)",
      captionFont: '600 28px "Inter", sans-serif',
      dateFont: '400 20px "Inter", sans-serif',
      uppercase: true,
      decorate(ctx, w, h) {
        // film sprocket holes down both edges
        ctx.fillStyle = "#f2f0ec";
        const holeW = 26, holeH = 18, step = 52;
        for (let y = 34; y < h - 40; y += step) {
          roundRect(ctx, 22, y, holeW, holeH, 5);
          ctx.fill();
          roundRect(ctx, w - 22 - holeW, y, holeW, holeH, 5);
          ctx.fill();
        }
      },
    },
    blush: {
      bg: "#fbeef0", fg: "#a34a58", sub: "#c98a95",
      pad: 48, gap: 28, footerH: 152,
      captionFrac: 0.34, dateFrac: 0.58,
      filter: "saturate(1.05) brightness(1.03)",
      captionFont: 'italic 500 34px "Fraunces", serif',
      dateFont: '400 20px "Inter", sans-serif',
      roundPhotos: 18,
      decorate(ctx, w, h) {
        ctx.fillStyle = "#dd8b98";
        drawHeart(ctx, w / 2, h - 30, 10);
        drawHeart(ctx, w / 2 - 32, h - 27, 5.5);
        drawHeart(ctx, w / 2 + 32, h - 27, 5.5);
      },
    },
    retro: {
      bg: "#f3ecdc", fg: "#5b4a32", sub: "#a3906f",
      pad: 50, gap: 30, footerH: 136,
      filter: "sepia(0.38) contrast(0.98) brightness(1.02)",
      captionFont: '400 30px "Courier New", monospace',
      dateFont: '400 20px "Courier New", monospace',
      dateStamp: true,
      decorate(ctx, w, h) {
        ctx.strokeStyle = "#c7b48c";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(20, 20, w - 40, h - 40);
        ctx.setLineDash([]);
      },
    },
  };

  const PHOTO_W = 640, PHOTO_H = 480;

  // ---------- canvas helpers ----------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  function drawHeart(ctx, cx, cy, size) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.9);
    ctx.bezierCurveTo(cx - size * 1.6, cy - size * 0.4, cx - size * 0.7, cy - size * 1.4, cx, cy - size * 0.4);
    ctx.bezierCurveTo(cx + size * 0.7, cy - size * 1.4, cx + size * 1.6, cy - size * 0.4, cx, cy + size * 0.9);
    ctx.fill();
  }

  // ---------- fun filters ----------
  // Drawn as vector overlays sized to a "typical face" spot in the frame —
  // line up your face with the preview and they land right.
  function faceBox(r) {
    const fw = Math.min(r.w * 0.62, r.h * 0.5);
    return {
      cx: r.x + r.w / 2,
      fw,
      top: r.y + r.h * 0.2,
      eyeY: r.y + r.h * 0.4,
      noseY: r.y + r.h * 0.5,
      mouthY: r.y + r.h * 0.62,
    };
  }

  function blob(ctx, x, y, rx, ry, rot, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  const FILTERS = {
    none: null,
    dog(ctx, r) {
      const f = faceBox(r);
      blob(ctx, f.cx - f.fw * 0.45, f.top, f.fw * 0.16, f.fw * 0.3, -0.5, "#7a4f33");
      blob(ctx, f.cx + f.fw * 0.45, f.top, f.fw * 0.16, f.fw * 0.3, 0.5, "#7a4f33");
      blob(ctx, f.cx - f.fw * 0.45, f.top + f.fw * 0.03, f.fw * 0.09, f.fw * 0.2, -0.5, "#a8765a");
      blob(ctx, f.cx + f.fw * 0.45, f.top + f.fw * 0.03, f.fw * 0.09, f.fw * 0.2, 0.5, "#a8765a");
      blob(ctx, f.cx, f.noseY, f.fw * 0.13, f.fw * 0.095, 0, "#26201c");
      blob(ctx, f.cx - f.fw * 0.045, f.noseY - f.fw * 0.03, f.fw * 0.035, f.fw * 0.02, -0.4, "rgba(255,255,255,0.35)");
      ctx.fillStyle = "#ff8fa3";
      roundRect(ctx, f.cx - f.fw * 0.09, f.mouthY, f.fw * 0.18, f.fw * 0.26, f.fw * 0.09);
      ctx.fill();
      ctx.strokeStyle = "#e56f86";
      ctx.lineWidth = Math.max(2, f.fw * 0.015);
      ctx.beginPath();
      ctx.moveTo(f.cx, f.mouthY + f.fw * 0.05);
      ctx.lineTo(f.cx, f.mouthY + f.fw * 0.2);
      ctx.stroke();
    },
    bunny(ctx, r) {
      const f = faceBox(r);
      const earY = f.top - f.fw * 0.3;
      blob(ctx, f.cx - f.fw * 0.22, earY, f.fw * 0.11, f.fw * 0.38, -0.12, "#f7f3ee");
      blob(ctx, f.cx + f.fw * 0.22, earY, f.fw * 0.11, f.fw * 0.38, 0.12, "#f7f3ee");
      blob(ctx, f.cx - f.fw * 0.22, earY + f.fw * 0.04, f.fw * 0.055, f.fw * 0.26, -0.12, "#f5b8c4");
      blob(ctx, f.cx + f.fw * 0.22, earY + f.fw * 0.04, f.fw * 0.055, f.fw * 0.26, 0.12, "#f5b8c4");
      blob(ctx, f.cx, f.noseY, f.fw * 0.07, f.fw * 0.05, 0, "#f08ca0");
      ctx.strokeStyle = "rgba(40,30,25,0.75)";
      ctx.lineWidth = Math.max(2, f.fw * 0.012);
      for (const side of [-1, 1]) {
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(f.cx + side * f.fw * 0.1, f.noseY + i * f.fw * 0.02);
          ctx.quadraticCurveTo(
            f.cx + side * f.fw * 0.3, f.noseY + i * f.fw * 0.06,
            f.cx + side * f.fw * 0.45, f.noseY + i * f.fw * 0.09
          );
          ctx.stroke();
        }
      }
    },
    shades(ctx, r) {
      const f = faceBox(r);
      const lw = f.fw * 0.3, lh = f.fw * 0.2, gap = f.fw * 0.08;
      ctx.fillStyle = "#17171a";
      roundRect(ctx, f.cx - gap / 2 - lw, f.eyeY - lh / 2, lw, lh, lh * 0.35);
      ctx.fill();
      roundRect(ctx, f.cx + gap / 2, f.eyeY - lh / 2, lw, lh, lh * 0.35);
      ctx.fill();
      ctx.strokeStyle = "#17171a";
      ctx.lineWidth = Math.max(3, f.fw * 0.03);
      ctx.beginPath();
      ctx.moveTo(f.cx - gap / 2, f.eyeY - lh * 0.15);
      ctx.quadraticCurveTo(f.cx, f.eyeY - lh * 0.4, f.cx + gap / 2, f.eyeY - lh * 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(f.cx - gap / 2 - lw, f.eyeY - lh * 0.1);
      ctx.lineTo(f.cx - f.fw * 0.62, f.eyeY - lh * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(f.cx + gap / 2 + lw, f.eyeY - lh * 0.1);
      ctx.lineTo(f.cx + f.fw * 0.62, f.eyeY - lh * 0.3);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = Math.max(2, f.fw * 0.02);
      ctx.beginPath();
      ctx.moveTo(f.cx - gap / 2 - lw * 0.75, f.eyeY - lh * 0.15);
      ctx.lineTo(f.cx - gap / 2 - lw * 0.35, f.eyeY + lh * 0.2);
      ctx.stroke();
    },
    mustache(ctx, r) {
      const f = faceBox(r);
      const y = f.mouthY - f.fw * 0.06;
      ctx.fillStyle = "#33241a";
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(f.cx, y);
        ctx.bezierCurveTo(
          f.cx + s * f.fw * 0.05, y - f.fw * 0.07,
          f.cx + s * f.fw * 0.28, y - f.fw * 0.08,
          f.cx + s * f.fw * 0.34, y - f.fw * 0.16
        );
        ctx.bezierCurveTo(
          f.cx + s * f.fw * 0.38, y - f.fw * 0.02,
          f.cx + s * f.fw * 0.2, y + f.fw * 0.09,
          f.cx, y + f.fw * 0.035
        );
        ctx.closePath();
        ctx.fill();
      }
    },
    hearts(ctx, r) {
      const f = faceBox(r);
      const y0 = f.top - f.fw * 0.18;
      const cols = ["#c9564e", "#e78fa0", "#c9564e", "#e78fa0", "#c9564e"];
      const pos = [-0.5, -0.26, 0, 0.26, 0.5];
      const ys = [0.06, -0.02, -0.07, -0.02, 0.06];
      const sz = [0.07, 0.09, 0.12, 0.09, 0.07];
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = cols[i];
        drawHeart(ctx, f.cx + pos[i] * f.fw * 1.15, y0 + ys[i] * f.fw, sz[i] * f.fw);
      }
    },
    crown(ctx, r) {
      const f = faceBox(r);
      const w = f.fw * 0.72, h = f.fw * 0.4;
      const x0 = f.cx - w / 2, yb = f.top - f.fw * 0.05;
      ctx.fillStyle = "#e8b23a";
      ctx.strokeStyle = "#c2902b";
      ctx.lineWidth = Math.max(2, f.fw * 0.02);
      ctx.beginPath();
      ctx.moveTo(x0, yb);
      ctx.lineTo(x0, yb - h * 0.55);
      ctx.lineTo(x0 + w * 0.25, yb - h * 0.3);
      ctx.lineTo(f.cx, yb - h);
      ctx.lineTo(x0 + w * 0.75, yb - h * 0.3);
      ctx.lineTo(x0 + w, yb - h * 0.55);
      ctx.lineTo(x0 + w, yb);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#c9564e";
      [0.12, 0.5, 0.88].forEach((p) => {
        ctx.beginPath();
        ctx.arc(x0 + w * p, yb - h * 0.18, f.fw * 0.035, 0, Math.PI * 2);
        ctx.fill();
      });
    },
  };

  function applyFilter(ctx, key, region) {
    if (key && FILTERS[key]) FILTERS[key](ctx, region);
  }

  function drawOverlay(canvas, key) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    applyFilter(ctx, key, { x: 0, y: 0, w, h });
  }

  function refreshOverlays() {
    drawOverlay($("#localOverlay"), state.filter);
    drawOverlay($("#remoteOverlay"), duo.active ? duo.remoteFilter : "none");
  }

  function prettyDate() {
    return new Date()
      .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      .toLowerCase();
  }

  function stampDate() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(2);
    return `${mm} ${dd} '${yy}`;
  }

  // ---------- screens ----------
  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $("#" + id).classList.add("active");
    window.scrollTo({ top: 0 });
    if (duo.active && (id === "screen-home" || id === "screen-together" || id === "screen-live")) {
      leaveDuo(false);
    }
    if (id !== "screen-booth" && !duo.active) stopCamera();
    if (id === "screen-setup") {
      const note = $("#setupDuoNote");
      note.hidden = !duo.active;
      if (duo.active) note.innerHTML = "&hearts; they're in the room — you're choosing for both of you";
    }
    if (id === "screen-booth") updateBoothUI();
  }

  $$("[data-goto]").forEach((btn) =>
    btn.addEventListener("click", () => showScreen(btn.dataset.goto))
  );
  $("#homeLink").addEventListener("click", () => showScreen("screen-home"));

  // ---------- setup screen ----------
  $$(".design-card").forEach((card) =>
    card.addEventListener("click", () => {
      $$(".design-card").forEach((c) => {
        c.classList.remove("selected");
        c.setAttribute("aria-checked", "false");
      });
      card.classList.add("selected");
      card.setAttribute("aria-checked", "true");
      state.theme = card.dataset.theme;
    })
  );

  $$(".seg").forEach((seg) =>
    seg.addEventListener("click", () => {
      $$(".seg").forEach((s) => {
        s.classList.remove("selected");
        s.setAttribute("aria-checked", "false");
      });
      seg.classList.add("selected");
      seg.setAttribute("aria-checked", "true");
      state.shots = parseInt(seg.dataset.shots, 10);
    })
  );

  $("#openBoothBtn").addEventListener("click", async () => {
    showScreen("screen-booth");
    renderDots(0, state.shots);
    await startCamera();
  });

  // ---------- filter picker ----------
  $$(".filter-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      $$(".filter-chip").forEach((c) => {
        c.classList.remove("selected");
        c.setAttribute("aria-checked", "false");
      });
      chip.classList.add("selected");
      chip.setAttribute("aria-checked", "true");
      state.filter = chip.dataset.filter;
      if (duo.active && duo.conn && duo.connOpen) {
        try { duo.conn.send({ type: "filter", value: state.filter }); } catch (_) {}
      }
      refreshOverlays();
    })
  );

  window.addEventListener("resize", () => {
    if ($("#screen-booth").classList.contains("active")) refreshOverlays();
  });

  // ---------- camera ----------
  async function startCamera() {
    if (duo.active && state.stream) {
      // the stream is feeding the live call — don't restart it
      updateBoothUI();
      return;
    }
    stopCamera();
    const video = $("#video");
    const errBox = $("#cameraError");
    errBox.hidden = true;
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: state.facing,
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      video.srcObject = state.stream;
      video.classList.toggle("mirrored", state.facing === "user");
      // don't await play(): it only settles once frames arrive, and a slow
      // camera would stall the duo call setup below
      video.play().catch(() => {});
      if (duo.active) {
        if (duo.role === "guest") makeCall();
        else tryAnswer();
      }
      updateBoothUI();
    } catch (err) {
      $("#shutterBtn").disabled = true;
      const msg = $("#cameraErrorMsg");
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        msg.textContent = window.isSecureContext
          ? "Camera access was blocked. Allow it in your browser's site settings, then try again."
          : "Cameras only work over HTTPS (or localhost). Open the site with https:// and try again.";
      } else if (err && err.name === "NotFoundError") {
        msg.textContent = "No camera was found on this device.";
      } else if (err && err.name === "NotReadableError") {
        msg.textContent = "Another app is using the camera. Close it and try again.";
      } else {
        msg.textContent = "Something went wrong opening the camera. Please try again.";
      }
      $("#cameraError").hidden = false;
      if (duo.active && duo.conn && duo.connOpen) {
        try { duo.conn.send({ type: "camera-trouble" }); } catch (_) {}
      }
    }
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    const video = $("#video");
    if (video) video.srcObject = null;
  }

  $("#retryCameraBtn").addEventListener("click", startCamera);

  $("#flipBtn").addEventListener("click", async () => {
    if (state.capturing || duo.active) return;
    state.facing = state.facing === "user" ? "environment" : "user";
    await startCamera();
  });

  $("#boothBackBtn").addEventListener("click", () => {
    if (state.capturing) return;
    if (duo.active && duo.role === "guest") showScreen("screen-home");
    else showScreen("screen-setup");
  });

  // ---------- capture flow ----------
  function renderDots(done, total) {
    const wrap = $("#shotDots");
    wrap.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const dot = document.createElement("span");
      if (i < done) dot.classList.add("done");
      wrap.appendChild(dot);
    }
  }

  function beep(freq, dur = 0.09) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      beep.ctx = beep.ctx || new AC();
      const ctx = beep.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (_) { /* sound is optional */ }
  }

  function flash() {
    const el = $("#flash");
    el.classList.remove("on");
    void el.offsetWidth; // restart animation
    el.classList.add("on");
  }

  async function countdown(from) {
    const el = $("#countdown");
    for (let n = from; n >= 1; n--) {
      el.textContent = n;
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
      beep(660);
      await wait(1000);
    }
    el.textContent = "";
    el.classList.remove("pop");
  }

  function grabFrame() {
    const video = $("#video");
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    // center-crop the video frame to 4:3
    let sw = vw, sh = vh;
    if (vw / vh > 4 / 3) sw = Math.round(vh * (4 / 3));
    else sh = Math.round(vw * (3 / 4));
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);

    const c = document.createElement("canvas");
    c.width = PHOTO_W;
    c.height = PHOTO_H;
    const ctx = c.getContext("2d");
    if (state.facing === "user") {
      // mirror so the photo matches what you saw in the preview
      ctx.translate(PHOTO_W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, PHOTO_W, PHOTO_H);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // undo the mirror before decorating
    applyFilter(ctx, state.filter, { x: 0, y: 0, w: PHOTO_W, h: PHOTO_H });
    return c;
  }

  function drawVideoHalf(ctx, videoEl, dx, mirror) {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) return;
    const halfW = PHOTO_W / 2;
    const r = halfW / PHOTO_H; // 2:3 portrait crop per person
    let sw = vw, sh = vh;
    if (vw / vh > r) sw = Math.round(vh * r);
    else sh = Math.round(vw / r);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);
    ctx.save();
    if (mirror) {
      ctx.translate(dx + halfW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, halfW, PHOTO_H);
    } else {
      ctx.drawImage(videoEl, sx, sy, sw, sh, dx, 0, halfW, PHOTO_H);
    }
    ctx.restore();
  }

  function grabDuoFrame() {
    // host is always the left half so both partners' strips come out identical
    const local = $("#video");
    const remote = $("#remoteVideo");
    const c = document.createElement("canvas");
    c.width = PHOTO_W;
    c.height = PHOTO_H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
    const localMirror = state.facing === "user";
    if (duo.role === "host") {
      drawVideoHalf(ctx, local, 0, localMirror);
      drawVideoHalf(ctx, remote, PHOTO_W / 2, true);
    } else {
      drawVideoHalf(ctx, remote, 0, true);
      drawVideoHalf(ctx, local, PHOTO_W / 2, localMirror);
    }
    // each person's chosen filter lands on their own half
    const half = PHOTO_W / 2;
    const leftFilter = duo.role === "host" ? state.filter : duo.remoteFilter;
    const rightFilter = duo.role === "host" ? duo.remoteFilter : state.filter;
    applyFilter(ctx, leftFilter, { x: 0, y: 0, w: half, h: PHOTO_H });
    applyFilter(ctx, rightFilter, { x: half, y: 0, w: half, h: PHOTO_H });
    ctx.fillStyle = "rgba(251, 250, 247, 0.65)";
    ctx.fillRect(PHOTO_W / 2 - 1, 0, 2, PHOTO_H);
    return c;
  }

  function currentCaption() {
    return $("#captionInput").value.trim() || "you + me";
  }

  $("#shutterBtn").addEventListener("click", () => {
    if (state.capturing || !state.stream) return;
    if (duo.active) {
      if (duo.role !== "host" || !duo.connOpen || !duo.remoteReady) return;
      const settings = { theme: state.theme, shots: state.shots, caption: currentCaption(), filter: state.filter };
      try { duo.conn.send({ type: "go", settings }); } catch (_) {}
      runCapture({ ...settings, duo: true });
    } else {
      runCapture({ theme: state.theme, shots: state.shots, caption: currentCaption(), duo: false });
    }
  });

  async function runCapture(s) {
    if (state.capturing || !state.stream) return;
    state.capturing = true;
    $("#shutterBtn").disabled = true;
    $("#flipBtn").disabled = true;
    $("#boothBackBtn").disabled = true;

    const shots = [];
    renderDots(0, s.shots);
    for (let i = 0; i < s.shots; i++) {
      await countdown(3);
      const frame = s.duo ? grabDuoFrame() : grabFrame();
      if (frame) shots.push(frame);
      flash();
      beep(990, 0.14);
      renderDots(shots.length, s.shots);
      await wait(650);
    }

    state.capturing = false;
    $("#flipBtn").disabled = false;
    $("#boothBackBtn").disabled = false;
    updateBoothUI();

    if (!shots.length) return;

    await document.fonts.ready;
    const strip = composeStrip(shots, s.theme, s.caption);
    state.lastStripUrl = strip.toDataURL("image/png");
    $("#resultImg").src = state.lastStripUrl;
    $("#shareBtn").hidden = !canShareFiles();
    showScreen("screen-result");
  }

  // ---------- strip composition ----------
  function composeStrip(shots, themeKey, caption) {
    const t = THEMES[themeKey];
    const w = PHOTO_W + t.pad * 2;
    const h = t.pad + shots.length * PHOTO_H + (shots.length - 1) * t.gap + t.footerH;

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    shots.forEach((shot, i) => {
      const y = t.pad + i * (PHOTO_H + t.gap);
      ctx.save();
      if (t.roundPhotos) {
        roundRect(ctx, t.pad, y, PHOTO_W, PHOTO_H, t.roundPhotos);
        ctx.clip();
      }
      try { ctx.filter = t.filter; } catch (_) {}
      ctx.drawImage(shot, t.pad, y, PHOTO_W, PHOTO_H);
      try { ctx.filter = "none"; } catch (_) {}
      ctx.restore();

      if (t.dateStamp) {
        ctx.font = '600 24px "Courier New", monospace';
        ctx.fillStyle = "rgba(255, 138, 66, 0.9)";
        ctx.textAlign = "right";
        ctx.fillText(stampDate(), t.pad + PHOTO_W - 18, y + PHOTO_H - 16);
      }
    });

    // footer: caption + date
    const footerTop = h - t.footerH;
    ctx.textAlign = "center";
    ctx.fillStyle = t.fg;
    ctx.font = t.captionFont;
    const text = t.uppercase ? caption.toUpperCase() : caption;
    ctx.fillText(text, w / 2, footerTop + t.footerH * (t.captionFrac || 0.42));
    ctx.fillStyle = t.sub;
    ctx.font = t.dateFont;
    ctx.fillText(prettyDate(), w / 2, footerTop + t.footerH * (t.dateFrac || 0.72));

    if (t.decorate) t.decorate(ctx, w, h);
    return c;
  }

  // ---------- download & share ----------
  function downloadDataUrl(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function fileStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function canShareFiles() {
    if (!navigator.canShare) return false;
    try {
      const f = new File([new Blob()], "t.png", { type: "image/png" });
      return navigator.canShare({ files: [f] });
    } catch (_) {
      return false;
    }
  }

  async function shareDataUrl(url, name) {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], name, { type: "image/png" });
    try {
      await navigator.share({ files: [file], title: "two·booth" });
    } catch (_) { /* user cancelled */ }
  }

  $("#downloadBtn").addEventListener("click", () => {
    if (state.lastStripUrl) downloadDataUrl(state.lastStripUrl, `twobooth-${fileStamp()}.png`);
  });

  $("#shareBtn").addEventListener("click", () => {
    if (state.lastStripUrl) shareDataUrl(state.lastStripUrl, `twobooth-${fileStamp()}.png`);
  });

  $("#retakeBtn").addEventListener("click", async () => {
    showScreen("screen-booth");
    renderDots(0, state.shots);
    await startCamera();
  });

  // ---------- together mode ----------
  $("#toTogetherBtn").addEventListener("click", () => {
    if (state.lastStripUrl) setSlot("A", state.lastStripUrl, "your latest strip");
    showScreen("screen-together");
  });

  function setSlot(which, url, label) {
    const img = new Image();
    img.onload = () => {
      state["img" + which] = img;
      const thumb = $("#thumb" + which);
      thumb.src = url;
      thumb.hidden = false;
      $("#slot" + which).classList.add("filled");
      $("#slot" + which + "Text").textContent = label;
      $("#mergeBtn").disabled = !(state.imgA && state.imgB);
    };
    img.src = url;
  }

  function wireSlot(which) {
    $("#file" + which).addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setSlot(which, reader.result, file.name);
      reader.readAsDataURL(file);
    });
  }
  wireSlot("A");
  wireSlot("B");

  $("#mergeBtn").addEventListener("click", async () => {
    if (!state.imgA || !state.imgB) return;
    await document.fonts.ready;
    const caption = $("#togetherCaption").value.trim() || "together, always";
    const canvas = composeCouple(state.imgA, state.imgB, caption);
    const url = canvas.toDataURL("image/png");
    $("#coupleImg").src = url;
    $("#coupleResultWrap").hidden = false;
    $("#coupleShareBtn").hidden = !canShareFiles();
    state.coupleUrl = url;
    $("#coupleImg").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function composeCouple(imgA, imgB, caption) {
    const H = 1400;              // common strip height
    const pad = 70, gap = 56, headerH = 170, footH = 90;
    const wA = Math.round(imgA.width * (H / imgA.height));
    const wB = Math.round(imgB.width * (H / imgB.height));
    const w = pad * 2 + wA + gap + wB;
    const h = headerH + H + footH;

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");

    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#e7e3da";
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, w - 48, h - 48);

    // header caption
    ctx.textAlign = "center";
    ctx.fillStyle = "#1c1a17";
    ctx.font = 'italic 500 52px "Fraunces", serif';
    ctx.fillText(caption, w / 2, headerH * 0.62);

    // strips with soft shadow
    ctx.save();
    ctx.shadowColor = "rgba(28, 26, 23, 0.28)";
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 14;
    ctx.drawImage(imgA, pad, headerH, wA, H);
    ctx.drawImage(imgB, pad + wA + gap, headerH, wB, H);
    ctx.restore();

    // heart between the strips
    ctx.fillStyle = "#c9564e";
    drawHeart(ctx, pad + wA + gap / 2, headerH + H / 2, 20);

    // footer date
    ctx.fillStyle = "#9a948a";
    ctx.font = '400 26px "Inter", sans-serif';
    ctx.fillText(`${prettyDate()} · miles apart, still together`, w / 2, h - footH * 0.42);

    return c;
  }

  $("#coupleDownloadBtn").addEventListener("click", () => {
    if (state.coupleUrl) downloadDataUrl(state.coupleUrl, `twobooth-together-${fileStamp()}.png`);
  });

  $("#coupleShareBtn").addEventListener("click", () => {
    if (state.coupleUrl) shareDataUrl(state.coupleUrl, `twobooth-together-${fileStamp()}.png`);
  });

  // ---------- optional TURN relay ----------
  // Direct peer-to-peer fails on some strict mobile networks (carrier NAT).
  // To fix it, create a free account at https://www.metered.ca/stun-turn
  // and paste your "credentials URL" below — it looks like:
  //   https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOURKEY
  const TURN_FETCH_URL = "";
  // …or paste static TURN entries here instead:
  const EXTRA_ICE_SERVERS = [
    { urls: "stun:stun.relay.metered.ca:80" },
    { urls: "turn:global.relay.metered.ca:80", username: "8e8c020fbc671512bf009b53", credential: "yWnWUUiFUNNGvONE" },
    { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "8e8c020fbc671512bf009b53", credential: "yWnWUUiFUNNGvONE" },
    { urls: "turn:global.relay.metered.ca:443", username: "8e8c020fbc671512bf009b53", credential: "yWnWUUiFUNNGvONE" },
    { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "8e8c020fbc671512bf009b53", credential: "yWnWUUiFUNNGvONE" },
  ];

  const BASE_ICE = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  let cachedIce = null;
  async function iceConfig() {
    if (!cachedIce) {
      let extra = EXTRA_ICE_SERVERS;
      if (TURN_FETCH_URL) {
        try {
          const list = await (await fetch(TURN_FETCH_URL)).json();
          if (Array.isArray(list) && list.length) extra = list;
        } catch (_) { /* relay service unreachable — keep direct-only */ }
      }
      cachedIce = { iceServers: BASE_ICE.concat(extra) };
    }
    return cachedIce;
  }

  // ---------- live together (duo) ----------
  function genCode() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no lookalike characters
    let code = "";
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  function updateBoothUI() {
    const isDuo = duo.active;
    $("#remotePane").hidden = !isDuo;
    $("#localLabel").hidden = !isDuo;
    $("#flipBtn").hidden = isDuo;
    // host stays on the left on both devices, matching the printed strip
    $("#cameraWrap").classList.toggle("guest-view", isDuo && duo.role === "guest");
    refreshOverlays();
    $("#remoteWaiting").hidden = !isDuo || duo.remoteReady;
    const status = $("#duoStatus");
    status.hidden = !isDuo;
    if (isDuo) {
      if (!duo.connOpen) status.textContent = "connecting…";
      else if (duo.remoteCamTrouble) status.textContent = "they're having camera trouble on their side…";
      else if (!duo.remoteReady) status.textContent = "connected — waiting for their camera…";
      else status.textContent = duo.role === "host"
        ? `room ${duo.code} · you're both in ♥ press the button when you're ready`
        : "you're both in ♥ the host presses the button";
    }
    $("#boothTitle").textContent = isDuo ? "together, live" : "smile, you're on camera";
    $("#boothHint").textContent = isDuo && duo.role === "guest"
      ? "the host starts the countdown for both of you"
      : "3… 2… 1… each photo has a short countdown";
    $("#shutterBtn").disabled =
      state.capturing || !state.stream || (isDuo && (duo.role !== "host" || !duo.connOpen || !duo.remoteReady));
  }

  async function hostRoom() {
    leaveDuo(true);
    if (!window.Peer) {
      $("#hostStatus").textContent = "couldn't load the connection service — check your internet and reload.";
      return;
    }
    duo.active = true;
    duo.role = "host";
    duo.code = genCode();
    $("#roomCode").hidden = true;
    $("#hostStatus").textContent = "setting up your room…";
    const config = await iceConfig();
    if (!duo.active || duo.role !== "host") return; // user backed out while fetching
    const peer = new Peer(DUO_PREFIX + duo.code.toLowerCase(), { config });
    duo.peer = peer;
    peer.on("open", () => {
      $("#roomCode").textContent = duo.code;
      $("#roomCode").hidden = false;
      $("#hostStatus").textContent = "send them this code — waiting for them to join…";
    });
    peer.on("connection", (conn) => {
      if (duo.conn) { try { conn.close(); } catch (_) {} return; }
      wireConn(conn);
    });
    peer.on("call", (call) => {
      duo.pendingCall = call;
      tryAnswer();
    });
    peer.on("error", handlePeerError);
    peer.on("disconnected", () => { if (duo.active && duo.peer) duo.peer.reconnect(); });
  }

  async function joinRoom(code) {
    leaveDuo(true);
    if (!window.Peer) {
      $("#joinStatus").textContent = "couldn't load the connection service — check your internet and reload.";
      return;
    }
    duo.active = true;
    duo.role = "guest";
    duo.code = code;
    $("#joinStatus").textContent = "looking for their booth…";
    const config = await iceConfig();
    if (!duo.active || duo.role !== "guest") return; // user backed out while fetching
    const peer = new Peer({ config });
    duo.peer = peer;
    peer.on("open", () => {
      wireConn(peer.connect(DUO_PREFIX + code.toLowerCase(), { reliable: true }));
    });
    peer.on("error", handlePeerError);
    peer.on("disconnected", () => { if (duo.active && duo.peer) duo.peer.reconnect(); });
    // if the room was found but the devices can't reach each other, say so
    setTimeout(() => {
      if (duo.active && duo.role === "guest" && duo.peer === peer && !duo.connOpen) {
        $("#joinStatus").textContent =
          "still trying… if this never connects, your two networks can't link directly — a relay is needed (see the README on GitHub).";
      }
    }, 15000);
  }

  function wireConn(conn) {
    duo.conn = conn;
    conn.on("open", async () => {
      duo.connOpen = true;
      if (state.filter !== "none") {
        try { conn.send({ type: "filter", value: state.filter }); } catch (_) {}
      }
      if (duo.role === "host") {
        $("#hostStatus").textContent = "they're here!";
        showScreen("screen-setup");
      } else {
        $("#joinStatus").textContent = "connected!";
        showScreen("screen-booth");
        renderDots(0, state.shots);
        await startCamera();
      }
      updateBoothUI();
    });
    conn.on("data", onDuoData);
    conn.on("close", onPeerGone);
    conn.on("error", onPeerGone);
  }

  function makeCall() {
    if (!duo.active || duo.role !== "guest" || !state.stream || duo.call || !duo.peer) return;
    const call = duo.peer.call(DUO_PREFIX + duo.code.toLowerCase(), state.stream);
    duo.call = call;
    call.on("stream", attachRemote);
  }

  function tryAnswer() {
    if (!duo.pendingCall || !state.stream) return;
    const call = duo.pendingCall;
    duo.pendingCall = null;
    duo.call = call;
    call.on("stream", attachRemote);
    call.answer(state.stream);
  }

  function attachRemote(stream) {
    const rv = $("#remoteVideo");
    rv.srcObject = stream;
    rv.classList.add("mirrored"); // partners are on selfie cams — mirror to match their own preview
    rv.play().catch(() => {});
    const ready = () => {
      duo.remoteReady = true;
      duo.remoteCamTrouble = false;
      updateBoothUI();
    };
    if (rv.readyState >= 1) ready();
    else rv.onloadedmetadata = ready;
  }

  async function onDuoData(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "go" && msg.settings) {
      if (state.capturing) return;
      if (FILTERS.hasOwnProperty(msg.settings.filter)) duo.remoteFilter = msg.settings.filter;
      if (!$("#screen-booth").classList.contains("active")) showScreen("screen-booth");
      if (!state.stream) await startCamera();
      runCapture({
        theme: msg.settings.theme,
        shots: msg.settings.shots,
        caption: msg.settings.caption,
        duo: true,
      });
    } else if (msg.type === "filter") {
      duo.remoteFilter = FILTERS.hasOwnProperty(msg.value) ? msg.value : "none";
      refreshOverlays();
    } else if (msg.type === "camera-trouble") {
      duo.remoteCamTrouble = true;
      updateBoothUI();
    } else if (msg.type === "bye") {
      onPeerGone();
    }
  }

  function onPeerGone() {
    if (!duo.active) return;
    const wasHost = duo.role === "host";
    leaveDuo(true);
    updateBoothUI();
    if ($("#screen-booth").classList.contains("active") || $("#screen-result").classList.contains("active")) {
      $("#duoStatus").hidden = false;
      $("#duoStatus").textContent = "they left the booth — head home to start a new room";
    } else if ($("#screen-setup").classList.contains("active")) {
      const note = $("#setupDuoNote");
      note.hidden = false;
      note.textContent = "they left the room — go back home to host a new code";
    } else {
      (wasHost ? $("#hostStatus") : $("#joinStatus")).textContent = "the connection ended — try again.";
    }
  }

  function handlePeerError(err) {
    const type = err && err.type;
    if (type === "unavailable-id" && duo.role === "host") {
      hostRoom(); // rare code collision — grab a fresh code
      return;
    }
    if (type === "peer-unavailable") {
      leaveDuo(true);
      $("#joinStatus").textContent = "couldn't find that code — double-check it and try again.";
      return;
    }
    if (duo.active) {
      const wasHost = duo.role === "host";
      leaveDuo(true);
      updateBoothUI();
      (wasHost ? $("#hostStatus") : $("#joinStatus")).textContent =
        "connection trouble — check your internet and try again.";
    }
  }

  function leaveDuo(keepStatus) {
    // reset state before touching the connection — a failed send() emits an
    // 'error' event that would otherwise re-enter onPeerGone in a loop
    const conn = duo.conn, call = duo.call, peer = duo.peer;
    duo.active = false;
    duo.role = null;
    duo.code = null;
    duo.peer = null;
    duo.conn = null;
    duo.call = null;
    duo.pendingCall = null;
    duo.connOpen = false;
    duo.remoteReady = false;
    duo.remoteCamTrouble = false;
    duo.remoteFilter = "none";
    if (conn) {
      try { conn.removeAllListeners(); } catch (_) {}
      if (conn.open) { try { conn.send({ type: "bye" }); } catch (_) {} }
      try { conn.close(); } catch (_) {}
    }
    if (call) { try { call.close(); } catch (_) {} }
    if (peer) { try { peer.destroy(); } catch (_) {} }
    const rv = $("#remoteVideo");
    if (rv) rv.srcObject = null;
    if (!keepStatus) {
      $("#roomCode").hidden = true;
      $("#hostStatus").textContent = "";
      $("#joinStatus").textContent = "";
    }
  }

  $("#hostBtn").addEventListener("click", hostRoom);

  $("#joinBtn").addEventListener("click", () => {
    const code = $("#joinCodeInput").value.trim().toUpperCase();
    if (code.length < 4) {
      $("#joinStatus").textContent = "enter the 4-letter code they sent you.";
      return;
    }
    joinRoom(code);
  });

  $("#joinCodeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#joinBtn").click();
  });

  window.addEventListener("beforeunload", () => {
    if (duo.active) leaveDuo(true);
  });

  window.__booth = { duo, state }; // debug handle

  // pause the camera while the tab is hidden, bring it back on return
  // (in a live session the stream keeps feeding the call, so leave it running)
  document.addEventListener("visibilitychange", () => {
    const onBooth = $("#screen-booth").classList.contains("active");
    if (document.hidden) {
      if (!state.capturing && !duo.active) stopCamera();
    } else if (onBooth && !state.stream && !state.capturing) {
      startCamera();
    }
  });
})();
