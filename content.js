// content.js — injected into ALL frames (main + iframes)
// Each frame checks if it has scrollable content.
// Only the frame with content responds and drives the capture loop.

var captureDelay = 350;
var waitForLazy  = true;

if (window.__scpListener) {
  chrome.runtime.onMessage.removeListener(window.__scpListener);
}
window.__scpListener = onMessage;
chrome.runtime.onMessage.addListener(onMessage);

function onMessage(data, sender, callback) {
  if (data.msg !== 'scrollPage') return;

  // Accept settings from background
  if (data.captureDelay) captureDelay = data.captureDelay;
  if (typeof data.lazyLoad !== 'undefined') waitForLazy = data.lazyLoad;

  var info = measureFrame();

  // Case 1 — this frame's document scrolls
  if (info.fullHeight > info.windowHeight + 50) {
    getPositions(callback, info);
    return true;
  }

  // Case 2 — inner scroll container inside this frame
  var scrollEl = findScrollContainer();
  if (scrollEl) {
    getPositionsCustom(callback, scrollEl);
    return true;
  }

  return false;
}

// ---------- helpers ----------

function max(nums) {
  return Math.max.apply(Math, nums.filter(function(x) { return x; }));
}

function measureFrame() {
  var body = document.body;
  var html = document.documentElement;
  var orig = body ? body.style.overflowY : '';
  if (body) body.style.overflowY = 'visible';
  var h = max([html.clientHeight, body ? body.scrollHeight : 0,
               html.scrollHeight, body ? body.offsetHeight : 0, html.offsetHeight]);
  var w = max([html.clientWidth,  body ? body.scrollWidth  : 0,
               html.scrollWidth,  body ? body.offsetWidth  : 0, html.offsetWidth]);
  if (body) body.style.overflowY = orig;
  return { fullHeight: h, fullWidth: w,
           windowHeight: window.innerHeight, windowWidth: window.innerWidth };
}

function findScrollContainer() {
  var best = null, bestH = 0;
  var all  = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.clientHeight < 50 || el.clientWidth < 50) continue;
    if (el.scrollHeight <= el.clientHeight + 5)       continue;
    var ov = window.getComputedStyle(el).overflowY;
    if (/auto|scroll|overlay|hidden/.test(ov) && el.scrollHeight > bestH) {
      bestH = el.scrollHeight;
      best  = el;
    }
  }
  return (best && best.scrollHeight > best.clientHeight + 50) ? best : null;
}

function getIframeRect() {
  if (window === window.top) return null;
  try {
    var frames = window.parent.document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      try {
        if (frames[i].contentWindow === window) {
          var r = frames[i].getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left),
                   width: Math.round(r.width), height: Math.round(r.height) };
        }
      } catch(e) {}
    }
  } catch(e) {}
  return null;
}

// Wait for all currently-loading images in the viewport to finish
function waitForImages(cb) {
  if (!waitForLazy) { cb(); return; }
  var imgs = document.querySelectorAll('img');
  var pending = [];
  for (var i = 0; i < imgs.length; i++) {
    if (!imgs[i].complete) pending.push(imgs[i]);
  }
  if (!pending.length) { cb(); return; }
  var count = 0;
  var done  = false;
  var finish = function() { if (!done) { done = true; cb(); } };
  var timeout = setTimeout(finish, 2000); // max 2 s wait
  pending.forEach(function(img) {
    img.addEventListener('load',  function() { if (++count === pending.length) { clearTimeout(timeout); finish(); } });
    img.addEventListener('error', function() { if (++count === pending.length) { clearTimeout(timeout); finish(); } });
  });
}

// ---------- Fixed element detection (Feature 4: Sticky/Fixed Header Compensation) ----------

function findFixedElements() {
  var fixed = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var pos = window.getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      // Only include elements that are visible and reasonably sized (likely headers/navbars)
      if (el.offsetWidth > 50 && el.offsetHeight > 5) {
        fixed.push(el);
      }
    }
  }
  return fixed;
}

function hideElements(els) {
  els.forEach(function(el) {
    el.__scpOrigVisibility = el.style.visibility;
    el.style.visibility = 'hidden';
  });
}

function showElements(els) {
  els.forEach(function(el) {
    el.style.visibility = el.__scpOrigVisibility !== undefined ? el.__scpOrigVisibility : '';
    delete el.__scpOrigVisibility;
  });
}

// ---------- standard capture (document scrolls) ----------

function getPositions(callback, info) {
  var body = document.body;
  var html = document.documentElement;
  var origOY  = body ? body.style.overflowY : '';
  var origOv  = html.style.overflow;
  var origX   = window.scrollX;
  var origY   = window.scrollY;

  if (body) body.style.overflowY = 'visible';

  var fullW  = info.fullWidth;
  var fullH  = info.fullHeight;
  var winW   = info.windowWidth;
  var winH   = info.windowHeight;

  if (fullW <= winW + 1) fullW = winW;
  if (fullH > 30000)     fullH = 30000;

  html.style.overflow = 'hidden';

  var iframeRect = getIframeRect();
  var isIframe   = !!iframeRect;

  var pad    = 200;
  var yDelta = winH - (winH > pad ? pad : 0);
  var arrs   = [];
  var yPos   = fullH - winH;
  while (yPos > -yDelta) { arrs.push(yPos); yPos -= yDelta; }

  var total = arrs.length;

  // Feature 4: Find fixed/sticky elements before starting the loop
  var fixedEls = findFixedElements();

  function cleanUp() {
    html.style.overflow = origOv;
    if (body) body.style.overflowY = origOY;
    window.scrollTo(origX, origY);
    // Always restore fixed elements visibility on cleanup
    showElements(fixedEls);
  }

  (function next() {
    if (!arrs.length) { cleanUp(); if (callback) callback(); return; }
    var y = arrs.shift();
    window.scrollTo(0, y);

    // Feature 4: Hide fixed elements for all strips except the topmost (y near 0)
    // The last strip in arrs is the topmost scroll position.
    // arrs has already been shifted, so when arrs is empty we just finished the last.
    // We hide fixed elements when y > winH/2 (not the top of the page).
    if (y > winH / 2) {
      hideElements(fixedEls);
    } else {
      showElements(fixedEls);
    }

    window.setTimeout(function() {
      waitForImages(function() {
        var data = {
          msg: 'capture',
          x: window.scrollX, y: window.scrollY,
          complete: (total - arrs.length) / total,
          windowWidth: winW, windowHeight: winH,
          totalWidth: fullW, totalHeight: fullH,
          devicePixelRatio: window.devicePixelRatio,
          customScroll: isIframe, containerRect: iframeRect
        };
        var t = window.setTimeout(cleanUp, 5000);
        chrome.runtime.sendMessage(data, function(ok) {
          // Always restore fixed elements after each capture
          showElements(fixedEls);
          window.clearTimeout(t);
          if (ok) next(); else cleanUp();
        });
      });
    }, captureDelay);
  })();
}

// ---------- custom inner scroll container ----------

function getPositionsCustom(callback, scrollEl) {
  var rect        = scrollEl.getBoundingClientRect();
  var origTop     = scrollEl.scrollTop;
  var fullH       = scrollEl.scrollHeight;
  var viewH       = scrollEl.clientHeight;
  var winW        = window.innerWidth;
  var winH        = window.innerHeight;
  var iframeRect  = getIframeRect();

  var crTop  = Math.round(rect.top  + (iframeRect ? iframeRect.top  : 0));
  var crLeft = Math.round(rect.left + (iframeRect ? iframeRect.left : 0));
  var containerRect = { top: crTop, left: crLeft,
                        width: Math.round(rect.width), height: Math.round(rect.height) };

  var pad    = 200;
  var yDelta = viewH - (viewH > pad ? pad : 0);
  var arrs   = [];
  var yPos   = fullH - viewH;
  while (yPos > -yDelta) { arrs.push(yPos); yPos -= yDelta; }

  var total = arrs.length;

  function cleanUp() { scrollEl.scrollTop = origTop; }

  (function next() {
    if (!arrs.length) { cleanUp(); if (callback) callback(); return; }
    var y = arrs.shift();
    scrollEl.scrollTop = y;

    window.setTimeout(function() {
      waitForImages(function() {
        var data = {
          msg: 'capture',
          x: 0, y: scrollEl.scrollTop,
          complete: (total - arrs.length) / total,
          windowWidth: winW, windowHeight: winH,
          totalWidth: winW, totalHeight: fullH,
          devicePixelRatio: window.devicePixelRatio,
          customScroll: true, containerRect: containerRect
        };
        var t = window.setTimeout(cleanUp, 5000);
        chrome.runtime.sendMessage(data, function(ok) {
          window.clearTimeout(t);
          if (ok) next(); else cleanUp();
        });
      });
    }, captureDelay);
  })();
}
