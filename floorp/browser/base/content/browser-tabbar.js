/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//-------------------------------------------------------------------------Tabbar----------------------------------------------------------------------------

function setTabbarMode() {
  const tabbarCSS = {
    HideTabBrowser: "@import url(chrome://browser/skin/tabbar/hide-tabbrowser.css);",
    VerticalTab: "@import url(chrome://browser/skin/tabbar/verticaltab.css);",
    BottomTabs: "@import url(chrome://browser/skin/tabbar/tabs_on_bottom.css);",
    WindowBottomTabs: "@import url(chrome://browser/skin/tabbar/tabbar_on_window_bottom.css);"
  }
  const tabbarPref = Services.prefs.getIntPref("floorp.browser.tabbar.settings");
  var Tag = document.createElement("style");
  Tag.setAttribute("id", "tabbardesgin");
  switch (tabbarPref) {
    case 1:
      //hide tabbrowser
      Tag.innerText = tabbarCSS.HideTabBrowser
      document.head.insertAdjacentElement('beforeend', Tag);
      break;
    case 2:
      // vertical tab CSS
      Tag.innerText = tabbarCSS.VerticalTab
      document.head.insertAdjacentElement('beforeend', Tag);
      window.setTimeout(function () {
        document.getElementById("titlebar").before(document.getElementById("toolbar-menubar"));
      }, 500);
      break;
    case 3:
      //tabs_on_bottom
      Tag.innerText = tabbarCSS.BottomTabs
      document.head.insertAdjacentElement('beforeend', Tag);
      break;
    case 4:
      Tag.innerText = tabbarCSS.WindowBottomTabs
      document.head.insertAdjacentElement('beforeend', Tag);
      var script = document.createElement("script");
      script.setAttribute("id", "tabbar-script");
      script.src = "chrome://browser/skin/tabbar/tabbar_on_window_bottom.js";
      document.head.appendChild(script);
      break;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTabbarMode();
  Services.prefs.addObserver("floorp.browser.tabbar.settings", function () {
    document.getElementById("tabbardesgin")?.remove();
    document.getElementById("tabbar-script")?.remove();
    document.getElementById("navigator-toolbox").insertBefore(document.getElementById("titlebar"), document.getElementById("navigator-toolbox").firstChild);
    document.getElementById("TabsToolbar").before(document.getElementById("toolbar-menubar"));
  
    setTabbarMode();
  });
}, { once: true });

//-------------------------------------------------------------------------Multirow-tabs----------------------------------------------------------------------------

function setMultirowTabMaxHeight() {
  let arrowscrollbox = document.querySelector("#tabbrowser-arrowscrollbox");
  let scrollbox = arrowscrollbox.shadowRoot.querySelector("[part=scrollbox]");

  arrowscrollbox.style.maxHeight = "";
  scrollbox.removeAttribute("style");

  const isMultiRowTabEnabled = Services.prefs.getBoolPref("floorp.browser.tabbar.multirow.max.enabled");
  const rowValue = Services.prefs.getIntPref("floorp.browser.tabbar.multirow.max.row");
    const tabHeight = document.querySelector(".tabbrowser-tab").clientHeight;
    arrowscrollbox
      .style.cssText += "max-height: unset !important;";
  if (isMultiRowTabEnabled && Services.prefs.getIntPref("floorp.tabbar.style") == 1) {
    scrollbox.setAttribute("style", `max-height: ${tabHeight * rowValue}px !important;`);
  }else{
    scrollbox.setAttribute("style", `max-height: unset !important;`);
  }
  
}

function removeMultirowTabMaxHeight() {
  document.querySelector("#tabbrowser-arrowscrollbox")
    .shadowRoot
    .querySelector("[part=scrollbox]")
    .removeAttribute("style");
}

function setNewTabInTabs(){
  if(Services.prefs.getBoolPref("floorp.browser.tabbar.multirow.newtab-inside.enabled")){
    document.querySelector("#tabs-newtab-button").style.display = "initial"
    document.querySelector("#new-tab-button").style.display = "none"
  }else{
    document.querySelector("#tabs-newtab-button").style.display = ""
    document.querySelector("#new-tab-button").style.display = ""
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.setTimeout(function(){
    setNewTabInTabs()
    if (Services.prefs.getIntPref("floorp.tabbar.style") == 1 || Services.prefs.getIntPref("floorp.tabbar.style") == 2) {
      setMultirowTabMaxHeight();
    }
  }, 3000);
  
  Services.prefs.addObserver("floorp.browser.tabbar.multirow.max.row",setMultirowTabMaxHeight);
  Services.prefs.addObserver("floorp.browser.tabbar.multirow.max.enabled",setMultirowTabMaxHeight);
  Services.prefs.addObserver("floorp.browser.tabbar.multirow.newtab-inside.enabled",setNewTabInTabs)
  

  let applyMultitab = () => {
    if (Services.prefs.getIntPref("floorp.tabbar.style") == 1 || Services.prefs.getIntPref("floorp.tabbar.style") == 2) {
      setBrowserDesign();
      setTimeout(setMultirowTabMaxHeight, 3000);
    } else {
      removeMultirowTabMaxHeight();
      setBrowserDesign();
      let tabToolbarItems = document.querySelector("#TabsToolbar > .toolbar-items");
      let tabsToolbar = document.getElementById("TabsToolbar-customization-target");
      let tabbrowserTabs = document.getElementById("tabbrowser-tabs");
      tabToolbarItems.style.visibility = "hidden";
      window.setTimeout(function(){
        new Promise(function() {
          tabsToolbar.setAttribute("flex", "");
          tabbrowserTabs.setAttribute("style", "-moz-box-flex: unset !important;");
          setTimeout(function() {
            tabsToolbar.setAttribute("flex", "1");
            tabbrowserTabs.style.removeProperty("-moz-box-flex");[
              tabToolbarItems.style.visibility = ""
            ]
          }, 0);
        })
      }, 1000);
    }
  }
  Services.prefs.addObserver("floorp.tabbar.style", applyMultitab);

  const tabs = document.querySelector(`#tabbrowser-tabs`)
  tabs.on_wheel = (event) => {
    if (Services.prefs.getBoolPref("toolkit.tabbox.switchByScrolling")) {
      if (event.deltaY > 0 != Services.prefs.getBoolPref("floorp.tabscroll.reverse")) {
        tabs.advanceSelectedTab(1, Services.prefs.getBoolPref("floorp.tabscroll.wrap"));
      } else {
        tabs.advanceSelectedTab(-1, Services.prefs.getBoolPref("floorp.tabscroll.wrap"));
      }
      event.preventDefault();
      event.stopPropagation();
    }
  }
}, { once: true })

/******************************************** Vivaldi Floorp **********************************************/

function extractColorsFromBase64Image(base64Image) {
  if (!base64Image) {
    return Promise.reject('No image provided');
  }
  const binaryData = atob(base64Image);
  const byteArray = new Uint8Array(binaryData.length);
  
  for (let i = 0; i < binaryData.length; i++) {
    byteArray[i] = binaryData.charCodeAt(i);
  }
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  return new Promise((resolve, reject) => {
    img.onload = function() {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = [];
      let totalRed = 0;
      let totalGreen = 0;
      let totalBlue = 0;
      const redCounts = {};
      const greenCounts = {};
      const blueCounts = {};
      
      for (let i = 0; i < pixelData.length; i += 4) {
        const red = pixelData[i];
        const green = pixelData[i + 1];
        const blue = pixelData[i + 2];
        
        if (red === 255 && green === 255 && blue === 255  || red === 0 && green === 0 && blue === 0) {
          continue;
        }
        
        totalRed += red;
        totalGreen += green;
        totalBlue += blue;
        
        const color = `rgb(${red}, ${green}, ${blue})`;
        colors.push(color);
        
        redCounts[red] = (redCounts[red] || 0) + 1;
        greenCounts[green] = (greenCounts[green] || 0) + 1;
        blueCounts[blue] = (blueCounts[blue] || 0) + 1;
      }
      
      const pixelCount = pixelData.length / 4;
      const averageRed = Math.round(totalRed / pixelCount);
      const averageGreen = Math.round(totalGreen / pixelCount);
      const averageBlue = Math.round(totalBlue / pixelCount);
      const averageColor = `rgb(${averageRed}, ${averageGreen}, ${averageBlue})`

      const mostFrequentRed = findMostFrequentValue(redCounts);
      const mostFrequentGreen = findMostFrequentValue(greenCounts);
      const mostFrequentBlue = findMostFrequentValue(blueCounts);
      const mostFrequentColor = `rgb(${mostFrequentRed}, ${mostFrequentGreen}, ${mostFrequentBlue})`;
      
      resolve({
        colors: colors,
        averageColor: averageColor,
        mostFrequentColor: mostFrequentColor
      });
    };
    
    img.onerror = reject;
    
    img.src = URL.createObjectURL(new Blob([byteArray]));
  });
}

function findMostFrequentValue(counts) {
  let mostFrequentValue;
  let maxCount = 0;
  
  for (const value in counts) {
    if (counts[value] > maxCount) {
      maxCount = counts[value];
      mostFrequentValue = value;
    }
  }
  
  return parseInt(mostFrequentValue);
}

function setVivaldiFloorp() {
  const base64Image = document.querySelector('.tab-icon-image[selected="true"]')?.src;
  const base64ImageWithoutHeader = base64Image?.split(',')[1];
  extractColorsFromBase64Image(base64ImageWithoutHeader)
    .then(result => {
      let elems = document.querySelectorAll(".floorp-toolbar-bgcolor");
      for (let i = 0; i < elems.length; i++) {
        elems[i].remove();
      }

      let elem = document.createElement("style");
      let CSS = `
        #navigator-toolbox:-moz-lwtheme {
          background-color: ${result.averageColor} !important;
        }
      `;
      elem.textContent = CSS;
      elem.className = "floorp-toolbar-bgcolor";
      document.head.appendChild(elem);
    })
    .catch(error => {
      let elems = document.querySelectorAll(".floorp-toolbar-bgcolor");
      for (let i = 0; i < elems.length; i++) {
        elems[i].remove();
      }
    });
}

window.setTimeout(function(){
  gBrowser.tabContainer.addEventListener("TabSelect", setVivaldiFloorp, false);
  gBrowser.tabContainer.addEventListener("TabMove", setVivaldiFloorp, false);
  gBrowser.tabContainer.addEventListener("TabAttrModified", setVivaldiFloorp, false);
  gBrowser.tabContainer.addEventListener("TabClose", setVivaldiFloorp, false);
  gBrowser.tabContainer.addEventListener("TabOpen", setVivaldiFloorp, false);
} , 1000);