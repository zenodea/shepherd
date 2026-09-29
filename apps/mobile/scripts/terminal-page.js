/* global Terminal, FitAddon */
// Runs inside the terminal WebView. React Native drives it through
// window.__sheperd(message) and hears back via ReactNativeWebView.postMessage.
(function () {
  var BG = "#0A0C0F";
  var el = document.getElementById("terminal");
  var term = new Terminal({
    fontFamily: "monospace",
    fontSize: 10,
    lineHeight: 1,
    cursorBlink: false,
    disableStdin: true,
    scrollback: 2000,
    theme: { background: BG, foreground: "#D8DEE4", cursor: "#D8DEE4" },
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);

  var mode = "native";

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function decode(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Native mode: pick a font size that fits all of the pane's columns across
  // the screen; the page can then be pinch-zoomed.
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

  window.__sheperd = function (msg) {
    switch (msg.type) {
      case "frames":
        for (var i = 0; i < msg.frames.length; i++) writeFrame(msg.frames[i]);
        break;
      case "reset":
        term.reset();
        break;
      case "mode":
        mode = msg.mode;
        document.body.className = mode;
        term.options.disableStdin = mode !== "fit";
        if (mode === "fit") {
          term.options.fontSize = msg.fontSize || 11;
          proposeFit();
        } else {
          scaleToWidth();
        }
        break;
    }
  };

  term.onData(function (data) {
    if (mode === "fit") post({ type: "input", data: data });
  });

  window.addEventListener("resize", function () {
    if (mode === "fit") proposeFit();
    else scaleToWidth();
  });

  post({ type: "ready" });
})();
