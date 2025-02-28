# -*- Mode: Java; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

<script type="text/javascript">

// This file contains the functions that are used by the floorp browser
Services.scriptloader.loadSubScript("chrome://browser/content/browser-command.js", this);

Services.scriptloader.loadSubScript("chrome://browser/content/browser-tabbar.js", this);
Services.scriptloader.loadSubScript("chrome://browser/content/browser-design.js", this);
Services.scriptloader.loadSubScript("chrome://browser/content/browser-rest-mode.js", this);


// This function is called when the floorp browser window is loaded. needs Delay.
document.addEventListener("DOMContentLoaded", () => {
    Services.scriptloader.loadSubScript("chrome://browser/content/browser-UI-custom.js", this);
    Services.scriptloader.loadSubScript("chrome://browser/content/browser-manager-sidebar.js", this);
    Services.scriptloader.loadSubScript("chrome://browser/content/browser-toolbar-buttons.js", this);
    Services.scriptloader.loadSubScript("chrome://browser/content/browser-statusbar.js", this);
    Services.scriptloader.loadSubScript("chrome://browser/content/browser-userChrome.js", this);
    Services.scriptloader.loadSubScript("chrome://browser/content/browser-preferences.js", this);
    Services.scriptloader.loadSubScript("chrome://browser/content/browser-pinned-tabs-title.js", this);
    Services.scriptloader.loadSubScript("chrome://browser/content/browser-chromeCSS.js", this);
}, { once: true });
</script>
