/* Mash Media — drop-in Microsoft (Entra ID) sign-in gate.
   Add to any static tool:  <script>window.PORTAL_AUTH={clientId,tenantId,allowedDomain}</script>
   then  <script src="auth.js"></script>  in the <head>.
   Hides the page until a matching company account signs in. */
(function () {
  var A = window.PORTAL_AUTH || {};
  if (!A.clientId || !A.tenantId) return;          // not configured -> no gate
  if (location.protocol === "file:") return;        // local preview -> no gate

  var hide = document.createElement("style");
  hide.textContent = "body{visibility:hidden!important}#mm-authgate{visibility:visible!important}";
  (document.head || document.documentElement).appendChild(hide);

  function err(m) { var e = document.getElementById("mm-err"); if (e) e.textContent = m || ""; }
  function reveal() {
    var g = document.getElementById("mm-authgate"); if (g && g.parentNode) g.parentNode.removeChild(g);
    if (hide.parentNode) hide.parentNode.removeChild(hide);
  }
  var app = null;

  function onSignedIn(acc) {
    var email = (acc && acc.username ? acc.username : "").toLowerCase();
    if (A.allowedDomain && email.indexOf("@" + A.allowedDomain.toLowerCase()) < 0) {
      err("Please sign in with your @" + A.allowedDomain + " account.");
      try { app.logoutPopup(); } catch (e) {}
      return;
    }
    reveal();
  }

  function gate(msg) {
    if (document.getElementById("mm-authgate")) { err(msg); return; }
    var g = document.createElement("div");
    g.id = "mm-authgate";
    g.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif");
    g.innerHTML =
      '<div style="background:#fff;border:1px solid #e2e7ee;border-radius:16px;padding:38px 34px;text-align:center;max-width:360px;width:90%;box-shadow:0 10px 28px rgba(40,30,70,.10)">' +
        '<svg viewBox="0 0 120 92" width="52" height="40" style="margin-bottom:14px" aria-hidden="true"><polyline points="14,76 34,16 60,54 86,16 106,76" fill="none" stroke="#574596" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/><polyline points="14,76 34,16 60,54 86,16 106,76" fill="none" stroke="#c7c7cf" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<h1 style="font-size:20px;font-weight:600;margin:0 0 6px;color:#574596">Mash Media</h1>' +
        '<p style="color:#66707d;font-size:13.5px;margin:0 0 22px">Sign in with your Mash Media Microsoft account to continue.</p>' +
        '<button id="mm-signin" style="display:inline-flex;align-items:center;gap:10px;background:#574596;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:14px;font-weight:600;cursor:pointer"><svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg> Sign in with Microsoft</button>' +
        '<div id="mm-err" style="color:#c0392b;font-size:12.5px;margin-top:14px;min-height:16px"></div>' +
      '</div>';
    document.documentElement.appendChild(g);
    err(msg);
    var btn = document.getElementById("mm-signin");
    btn.addEventListener("click", function () {
      err("");
      app.loginPopup({ scopes: ["User.Read"] })
        .then(function (r) { onSignedIn(r.account); })
        .catch(function () { err("Sign-in was cancelled or failed. Try again."); });
    });
  }

  function start() {
    app = new msal.PublicClientApplication({
      auth: { clientId: A.clientId, authority: "https://login.microsoftonline.com/" + A.tenantId, redirectUri: location.origin },
      cache: { cacheLocation: "localStorage" }
    });
    var accts = app.getAllAccounts();
    if (accts.length) {
      app.acquireTokenSilent({ scopes: ["User.Read"], account: accts[0] })
        .then(function () { onSignedIn(accts[0]); })
        .catch(function () { gate(""); });
    } else {
      gate("");
    }
  }

  var s = document.createElement("script");
  s.src = "https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.min.js";
  s.onload = start;
  s.onerror = function () { gate("Couldn't load sign-in. Please refresh."); };
  (document.head || document.documentElement).appendChild(s);
})();
