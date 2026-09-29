/* global Terminal, FitAddon */
// Runs inside the terminal WebView. React Native drives it through
// window.__sheperd(message) and hears back via ReactNativeWebView.postMessage:
//   in:  frames | history | reset | mode | scrollToBottom
//   out: ready | fitSize | tap | scroll {atBottom} | wheel {lines}
//
// Scrolling: in fit mode the phone controls the pane, so a drag asks herdr to
// scroll (wheel, positive = back in time). That works for shells (herdr's
// scrollback) and full-screen agents like Claude Code (herdr forwards the
// wheel). In full-width mode we only observe, so drags scroll locally through
// the history loaded when the terminal opened.
(function () {
  var BG = "#0A0A0A";
  var el = document.getElementById("terminal");
  var term = new Terminal({
    fontFamily: "Menlo, 'DejaVu Sans Mono', 'Droid Sans Mono', monospace",
    fontSize: 12,
    lineHeight: 1.15,
    cursorBlink: false,
    disableStdin: true,
    scrollback: 5000,
    // A full redraw keeps what was on screen in the scrollback (the history we
    // load first ends up there instead of being wiped).
    scrollOnEraseInDisplay: true,
    theme: { background: BG, foreground: "#E5E5E5", cursor: "#FAFAFA", selectionBackground: "rgba(250,250,250,0.25)" },
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);

  var mode = "fit";
  var lastWidth = window.innerWidth;
  var viewport = document.querySelector('meta[name="viewport"]');

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function decode(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Full width: fit all of the pane's columns across the screen (pinch to zoom).
  function scaleToWidth() {
    var width = window.innerWidth - 8;
    var size = Math.max(3, Math.min(16, width / (term.cols * 0.6)));
    term.options.fontSize = size;
    var screen = el.querySelector(".xterm-screen");
    if (screen && screen.offsetWidth > 0) {
      size = Math.max(3, Math.min(16, size * (width / screen.offsetWidth)));
      term.options.fontSize = Math.floor(size * 10) / 10;
    }
  }

  function proposeFit() {
    var dims = fit.proposeDimensions();
    if (dims && dims.cols > 0 && dims.rows > 0) post({ type: "fitSize", cols: dims.cols, rows: dims.rows });
  }

  function writeFrame(frame) {
    if (frame.width !== term.cols || frame.height !== term.rows) {
      term.resize(frame.width, frame.height);
      if (mode === "native") scaleToWidth();
    }
    term.write(decode(frame.bytes));
  }

  // --- scroll position ----------------------------------------------------
  var atBottom = true;
  var scrollbar = document.getElementById("scrollbar");
  var thumb = document.getElementById("thumb");
  var hideTimer = 0;

  function updateScroll() {
    var buffer = term.buffer.active;
    var hidden = buffer.length - term.rows;
    var nowAtBottom = hidden <= 0 || buffer.viewportY >= hidden;
    if (nowAtBottom !== atBottom) {
      atBottom = nowAtBottom;
      post({ type: "scroll", atBottom: atBottom });
    }
    if (hidden <= 0) return;
    var track = scrollbar.clientHeight;
    var size = Math.max(28, (track * term.rows) / buffer.length);
    thumb.style.height = size + "px";
    thumb.style.transform = "translateY(" + ((track - size) * buffer.viewportY) / hidden + "px)";
    scrollbar.classList.add("visible");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (atBottom) scrollbar.classList.remove("visible");
    }, 900);
  }
  term.onScroll(updateScroll);
  term.onWriteParsed(updateScroll);

  // --- touch: drag to scroll with momentum, tap to dismiss the keyboard ----
  function cellHeight() {
    var rows = el.querySelector(".xterm-rows");
    return rows && rows.firstChild ? rows.firstChild.getBoundingClientRect().height || 16 : 16;
  }
  function zoomed() {
    return window.visualViewport && window.visualViewport.scale > 1.01;
  }

  var touch = null;
  var momentum = 0;
  var carry = 0;
  var pendingWheel = 0;
  var wheelTimer = 0;

  function flushWheel() {
    wheelTimer = 0;
    if (pendingWheel !== 0) post({ type: "wheel", lines: pendingWheel });
    pendingWheel = 0;
  }

  function scrollByPixels(dy) {
    carry += dy;
    var h = cellHeight();
    var lines = carry > 0 ? Math.floor(carry / h) : Math.ceil(carry / h);
    if (lines === 0) return;
    carry -= lines * h;
    if (mode === "fit") {
      pendingWheel += lines;
      if (!wheelTimer) wheelTimer = setTimeout(flushWheel, 50);
    } else {
      term.scrollLines(-lines);
    }
  }

  el.addEventListener(
    "touchstart",
    function (e) {
      cancelAnimationFrame(momentum);
      if (e.touches.length !== 1 || zoomed()) {
        touch = null;
        return;
      }
      var t = e.touches[0];
      touch = { y: t.clientY, startY: t.clientY, startX: t.clientX, at: Date.now(), lastAt: Date.now(), velocity: 0, moved: false };
      carry = 0;
    },
    { passive: true },
  );

  el.addEventListener(
    "touchmove",
    function (e) {
      if (!touch || e.touches.length !== 1) return;
      var t = e.touches[0];
      var dy = t.clientY - touch.y;
      var now = Date.now();
      if (Math.abs(t.clientY - touch.startY) > 6) touch.moved = true;
      touch.velocity = dy / Math.max(1, now - touch.lastAt);
      touch.y = t.clientY;
      touch.lastAt = now;
      scrollByPixels(dy);
      e.preventDefault();
    },
    { passive: false },
  );

  el.addEventListener(
    "touchend",
    function (e) {
      if (!touch) return;
      var t = touch;
      touch = null;
      if (!t.moved && Date.now() - t.at < 300) {
        post({ type: "tap" });
        return;
      }
      // Glide to a stop, like a native list.
      var v = t.velocity * 16;
      function glide() {
        if (Math.abs(v) < 0.5) return;
        scrollByPixels(v);
        v *= 0.95;
        momentum = requestAnimationFrame(glide);
      }
      momentum = requestAnimationFrame(glide);
      e.preventDefault();
    },
    { passive: false },
  );

  // --- messages from React Native -----------------------------------------
  window.__sheperd = function (msg) {
    switch (msg.type) {
      case "frames":
        for (var i = 0; i < msg.frames.length; i++) writeFrame(msg.frames[i]);
        break;
      case "history":
        // Earlier output, written before the live screen so it can be scrolled back to.
        term.write(decode(msg.bytes));
        break;
      case "reset":
        term.reset();
        atBottom = true;
        scrollbar.classList.remove("visible");
        break;
      case "scrollToBottom":
        cancelAnimationFrame(momentum);
        term.scrollToBottom();
        break;
      case "mode":
        mode = msg.mode;
        document.body.className = mode;
        viewport.setAttribute(
          "content",
          mode === "fit"
            ? "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
            : "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes",
        );
        if (mode === "fit") {
          term.options.fontSize = msg.fontSize || 12;
          proposeFit();
        } else {
          scaleToWidth();
        }
        break;
    }
  };

  window.addEventListener("resize", function () {
    // The keyboard only changes the height: keep the pane's size (resizing it
    // would reflow the agent on your computer) and stay pinned to the bottom.
    if (window.innerWidth === lastWidth) {
      if (atBottom) term.scrollToBottom();
      window.scrollTo(0, document.body.scrollHeight);
      return;
    }
    lastWidth = window.innerWidth;
    if (mode === "fit") proposeFit();
    else scaleToWidth();
  });

  post({ type: "ready" });
})();
