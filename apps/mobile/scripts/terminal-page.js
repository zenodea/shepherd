/* global Terminal, FitAddon */
// Runs inside the terminal WebView. React Native drives it through
// window.__sheperd(message) and hears back via ReactNativeWebView.postMessage:
//   in:  frames | historyHtml | reset | mode | scrollToBottom | focus
//   out: ready | fitSize | tap | input {data} | scroll {atBottom} | wheel {lines}
//
// Fit mode ("fit to phone"): the page scrolls natively. Earlier output (as
// HTML, loaded by React Native) sits above the live terminal, which is sized
// to exactly one screen, so you scroll up out of the live view into history.
// Tapping the terminal opens the keyboard and types straight into the pane.
//
// Full-width mode: the pane at its real size, scaled to the screen and
// pinch-zoomable; a drag down asks React Native for its history view.
(function () {
  var BG = "#0A0A0A";
  var el = document.getElementById("terminal");
  var historyEl = document.getElementById("history");
  var term = new Terminal({
    fontFamily: "Menlo, 'DejaVu Sans Mono', 'Droid Sans Mono', monospace",
    fontSize: 12,
    lineHeight: 1.15,
    cursorBlink: false,
    disableStdin: true,
    scrollback: 0,
    theme: { background: BG, foreground: "#E5E5E5", cursor: "#FAFAFA", selectionBackground: "rgba(250,250,250,0.25)" },
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);

  var mode = "fit";
  var lastWidth = window.innerWidth;
  var viewport = document.querySelector('meta[name="viewport"]');
  var scroller = document.scrollingElement || document.documentElement;

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function decode(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // --- sizing ----------------------------------------------------------------
  function cellSize() {
    try {
      var cell = term._core._renderService.dimensions.css.cell;
      if (cell.width > 0 && cell.height > 0) return cell;
    } catch (e) {}
    var probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;font-family:" + term.options.fontFamily + ";font-size:" + term.options.fontSize + "px";
    probe.textContent = "WWWWWWWWWW";
    document.body.appendChild(probe);
    var width = probe.getBoundingClientRect().width / 10;
    document.body.removeChild(probe);
    return { width: width, height: Math.round(term.options.fontSize * term.options.lineHeight) };
  }

  // One screen of the phone: columns across, rows down the visible height.
  function proposeFit() {
    var cell = cellSize();
    var cols = Math.max(20, Math.floor((window.innerWidth - 14) / cell.width));
    var rows = Math.max(8, Math.floor((window.innerHeight - 4) / cell.height));
    post({ type: "fitSize", cols: cols, rows: rows });
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

  // --- scroll position (fit mode: the page scrolls) ------------------------
  var atBottom = true;
  function distanceFromBottom() {
    return scroller.scrollHeight - scroller.scrollTop - window.innerHeight;
  }
  function toBottom() {
    scroller.scrollTop = scroller.scrollHeight;
  }
  window.addEventListener(
    "scroll",
    function () {
      var now = distanceFromBottom() < 8;
      if (now !== atBottom) {
        atBottom = now;
        post({ type: "scroll", atBottom: atBottom });
      }
    },
    { passive: true },
  );

  function writeFrame(frame) {
    if (frame.width !== term.cols || frame.height !== term.rows) {
      term.resize(frame.width, frame.height);
      if (mode === "native") scaleToWidth();
    }
    term.write(decode(frame.bytes), function () {
      if (mode === "fit" && atBottom) toBottom();
    });
  }

  // --- touch -----------------------------------------------------------------
  function zoomed() {
    return window.visualViewport && window.visualViewport.scale > 1.01;
  }
  var touch = null;
  document.addEventListener(
    "touchstart",
    function (e) {
      touch =
        e.touches.length === 1 && !zoomed()
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now(), sent: false, moved: false, target: e.target }
          : null;
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    function (e) {
      if (!touch || e.touches.length !== 1) return;
      var dy = e.touches[0].clientY - touch.y;
      var dx = e.touches[0].clientX - touch.x;
      if (Math.abs(dy) > 6 || Math.abs(dx) > 6) touch.moved = true;
      // Full width has no history in the page: a drag down opens the history view.
      if (mode === "native" && !touch.sent && dy > 24 && Math.abs(dy) > Math.abs(dx)) {
        touch.sent = true;
        post({ type: "wheel", lines: 1 });
      }
    },
    { passive: true },
  );
  document.addEventListener("touchend", function () {
    var t = touch;
    touch = null;
    if (!t || t.moved || Date.now() - t.at > 300) return;
    // A tap on the live terminal in fit mode: type into it. Elsewhere: hide the keyboard.
    if (mode === "fit" && el.contains(t.target)) {
      term.focus();
    } else {
      term.blur();
      post({ type: "tap" });
    }
  });

  term.onData(function (data) {
    if (mode === "fit") post({ type: "input", data: data });
  });

  // --- messages from React Native -----------------------------------------
  window.__sheperd = function (msg) {
    switch (msg.type) {
      case "frames":
        for (var i = 0; i < msg.frames.length; i++) writeFrame(msg.frames[i]);
        break;
      case "historyHtml": {
        // Keep the reader's place: measure from the bottom, which doesn't move.
        var fromBottom = distanceFromBottom();
        historyEl.innerHTML = msg.html;
        scroller.scrollTop = scroller.scrollHeight - window.innerHeight - fromBottom;
        break;
      }
      case "reset":
        term.reset();
        historyEl.innerHTML = "";
        atBottom = true;
        toBottom();
        break;
      case "scrollToBottom":
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
        break;
      case "focus":
        if (mode === "fit") term.focus();
        break;
      case "mode":
        mode = msg.mode;
        document.body.className = mode;
        term.options.disableStdin = mode !== "fit";
        viewport.setAttribute(
          "content",
          mode === "fit"
            ? "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
            : "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes",
        );
        historyEl.innerHTML = "";
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
    // would reflow the agent on your computer) and keep the live line in view.
    if (window.innerWidth === lastWidth) {
      if (atBottom) toBottom();
      return;
    }
    lastWidth = window.innerWidth;
    if (mode === "fit") proposeFit();
    else scaleToWidth();
  });

  post({ type: "ready" });
})();
