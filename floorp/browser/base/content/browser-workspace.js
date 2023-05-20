/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//use _gBrowser instead of gBrowser when startup
const WORKSPACE_TAB_ENABLED_PREF = "floorp.browser.workspace.tab.enabled";
const WORKSPACE_CURRENT_PREF = "floorp.browser.workspace.current";
const WORKSPACE_ALL_PREF = "floorp.browser.workspace.all";
const WORKSPACE_TABS_PREF = "floorp.browser.workspace.tabs.state";
const l10n = new Localization(["browser/floorp.ftl"], true);
const defaultWorkspaceName = l10n.formatValueSync("workspace-default")

function initWorkspace() { 
  // First run
  if (!Services.prefs.prefHasUserValue(WORKSPACE_CURRENT_PREF)) {
    Services.prefs.setStringPref(WORKSPACE_CURRENT_PREF, defaultWorkspaceName);
    Services.prefs.setStringPref(WORKSPACE_ALL_PREF, defaultWorkspaceName);
  }

  let tabs = gBrowser.tabs;

  if (Services.prefs.getStringPref(WORKSPACE_TABS_PREF) === "[]") {
    for (let i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute("floorp-workspace", Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF));
    }
  } else {
    let tabsState = JSON.parse(Services.prefs.getStringPref(WORKSPACE_TABS_PREF));
    for (let i = 0; i < tabs.length; i++) {
      let tabStateSetting = tabsState[i];
      let workspace = tabStateSetting?.[i]?.workspace ?? Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);
      tabs[i].setAttribute("floorp-workspace", workspace);
    }
  }

  // Add workspace menu from preference
  let workspaceAll = Services.prefs.getStringPref(WORKSPACE_ALL_PREF).split(",");
  for (let i = 0; i < workspaceAll.length; i++) {
    let label = workspaceAll[i];
    addWorkspaceElemToMenu(label);
  }

  // Add attribute to tab
  addLastShowedWorkspaceTab();

  //add keybooard shortcut
  let keyElem = document.createElement("key");
  keyElem.setAttribute("id", "floorp-workspace-key");
  keyElem.setAttribute("keycode", "VK_F9");
  keyElem.setAttribute("oncommand", "restartbrowser();");
  document.getElementById("mainKeyset").appendChild(keyElem);

  saveWorkspaceState();
  setMenuItemCheckCSS();
}

function changeWorkspaceToNext() {
  let allWorkspaces = Services.prefs.getCharPref(WORKSPACE_ALL_PREF).split(",");
  let currentWorkspace = Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);
  let index = allWorkspaces.indexOf(currentWorkspace);
  let nextWorkspace = allWorkspaces[index + 1] ?? allWorkspaces[0];
  changeWorkspace(nextWorkspace);
}

function deleteworkspace(workspace) {
 if  (workspace !== defaultWorkspaceName) {
  let allWorkspaces = Services.prefs.getCharPref(WORKSPACE_ALL_PREF).split(",");
  let index = allWorkspaces.indexOf(workspace);
  let currentWorkspace = Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);

  //move to other workspace
  if (currentWorkspace == workspace) {
    changeWorkspace(allWorkspaces[0]);
    Services.prefs.setStringPref(WORKSPACE_CURRENT_PREF, defaultWorkspaceName);
    setCurrentWorkspace();
  }
  allWorkspaces.splice(index, 1);
  Services.prefs.setCharPref(WORKSPACE_ALL_PREF, allWorkspaces.join(","));

  //delete workspace tabs
  let tabs = gBrowser.tabs;
  for (let i = 0; i < tabs.length; i++) {
    let tab = tabs[i];
    let tabWorkspace = tab.getAttribute("floorp-workspace");
    if (tabWorkspace == workspace) {
      gBrowser.removeTab(tab);
    }
  }
  //delete workspace menuitem
  let menuitem = document.getElementById(`workspace-box-${workspace}`);
  menuitem.remove();
 }
}

function setCurrentWorkspace() {
  let tabs = gBrowser.tabs;
  let currentWorkspace = Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);

  document.querySelector(`[floorp-lastVisibleTab]`)?.removeAttribute("floorp-lastVisibleTab")
  document.querySelector(`[floorp-firstVisibleTab]`)?.removeAttribute("floorp-firstVisibleTab")
  let lastTab = null
  let firstTab = null
  for (let i = 0; i < tabs.length; i++) {
    let tab = tabs[i];
    let workspace = tab.getAttribute("floorp-workspace");
    if (workspace == currentWorkspace || !Services.prefs.getBoolPref(WORKSPACE_TAB_ENABLED_PREF)) {
      gBrowser.showTab(tab);
      lastTab = tab
      if(firstTab == null){
        tab.setAttribute("floorp-firstVisibleTab","true")
        firstTab = tab
      }
    } else {
      gBrowser.hideTab(tab);
    }

    if(currentWorkspace != l10n.formatValueSync("workspace-default")){
      document.getElementById("workspace-button").setAttribute("label", currentWorkspace);
      document.querySelector("#workspace-button > .toolbarbutton-text").style.display = "inherit"
    } else {
      document.getElementById("workspace-button").removeAttribute("label");
      document.querySelector("#workspace-button > .toolbarbutton-text").style.display = "none"
    }
  }
  lastTab?.setAttribute("floorp-lastVisibleTab","true")
} 

function saveWorkspaceState() {
  let tabs = gBrowser.tabs;
  let tabStateObject = [];
  for (let i = 0; i < tabs.length; i++) {
    let tab = tabs[i];
    let tabState = {
     [i]: {
        "workspace": tab.getAttribute("floorp-workspace"),
      }
    }
    tabStateObject.push(tabState);
  }
  Services.prefs.setStringPref(WORKSPACE_TABS_PREF, JSON.stringify(tabStateObject));
}

function addWorkspaceElemToMenu(label, nextElem) {
  let workspaceItemElem = window.MozXULElement.parseXULToFragment(`

  <vbox id="workspace-box-${label}" class="workspace-label-box">
   <hbox id="workspace-${label}" class="workspace-item-box">
     <toolbarbutton id="workspace-label" label="${label}"
               class="toolbarbutton-1 workspace-item" workspace="${label}"
               context="workspace-item-context" oncommand="changeWorkspace('${label}')"/>
   </hbox>
   <menuseparator class="workspace-item-separator"/>
  </vbox>
  `);

  if (nextElem) {
    nextElem.before(workspaceItemElem);
  } else {
    document.getElementById("addNewWorkspaceButton").before(workspaceItemElem);
  }
  
  if (label !== defaultWorkspaceName) {
    let deleteButtonElem = window.MozXULElement.parseXULToFragment(`
        <toolbarbutton id="workspace-delete" class="workspace-item-delete toolbarbutton-1"
                       oncommand="deleteworkspace('${label}')"/>
    `);
    document.getElementById(`workspace-${label}`).appendChild(deleteButtonElem);
  }
}

function changeWorkspace(label) {
  let tabs = gBrowser.tabs;

  Services.prefs.setStringPref(WORKSPACE_CURRENT_PREF, label);
  if(!checkWorkspaceLastShowedTabAttributeExist(label)){
    document.querySelector(`[floorp-workspace="${label}"]`)?.setAttribute(`lastShowWorkspaceTab-${label}`, "true");
  }
  for (let i = 0; i < tabs.length; i++) {
    let tab = tabs[i];
    if(tab.getAttribute(`lastShowWorkspaceTab-${label}`) == "true"){
      gBrowser.selectedTab = tab;
      break;
    } else if(i == tabs.length - 1){
      gBrowser.addTab("about:newtab", {
        skipAnimation: true,
        inBackground: false,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
      });
    }
  }
  setCurrentWorkspace();
  saveWorkspaceState();
}

function checkWorkspaceLastShowedTabAttributeExist(label) {
  let tabs = gBrowser.tabs;
  let exist = false;
  for (let i = 0; i < tabs.length; i++) {
    let tab = tabs[i];
    if (tab.getAttribute(`lastShowWorkspaceTab-${label}`) == "true") {
      exist = true;
      break;
    }
  }
  return exist;
}

function getNextToWorkspaceTab() {
  let tabs = gBrowser.tabs;
  let nextTab = null;
  for (let i = 0; i < tabs.length; i++) {
    let tab = tabs[i];
    if (tab.getAttribute("floorp-workspace") == gBrowser.selectedTab.getAttribute("floorp-workspace") && tab != gBrowser.selectedTab) {
      nextTab = tab;
      break;
    }
  }
  return nextTab;
}

function addNewWorkspace() {
  let allWorkspace = Services.prefs.getStringPref(WORKSPACE_ALL_PREF).split(",");
  let l10n = new Localization(["browser/floorp.ftl"], true);
  prompts = Services.prompt;
  let check = {value: false};
  let pattern = /^[\p{L}\p{N}]+$/u;
  let input = {value: ""};
  let result = prompts.prompt(null, l10n.formatValueSync("workspace-prompt-title"), l10n.formatValueSync("please-enter-workspace-name") + "\n" + l10n.formatValueSync("please-enter-workspace-name-2"), input, null, check);

  if (result && allWorkspace.indexOf(input.value) == -1 && input.value != "" && input.value.length < 20 && input.value != l10n.formatValueSync("workspace-default") && pattern.test(input.value)) {
    let label = input.value;
    let workspaceAll = Services.prefs.getStringPref(WORKSPACE_ALL_PREF).split(",");
    try {
      addWorkspaceElemToMenu(label);
    } catch (e) {
      prompts.alert(null, l10n.formatValueSync("workspace-prompt-title"), l10n.formatValueSync("workspace-error") + "\n" + l10n.formatValueSync("workspace-error-discription"));
      return;
    }
    workspaceAll.push(label);
    Services.prefs.setStringPref(WORKSPACE_ALL_PREF, workspaceAll);
  } else if(result == false){
    return;
  } else {
    prompts.alert(null, l10n.formatValueSync("workspace-prompt-title"), l10n.formatValueSync("workspace-error") + "\n" + l10n.formatValueSync("workspace-error-discription"));
  }
}

function createWorkspacemenuItemContext(e) {
  //remove old menuitem
  let oldMenuItems = document.querySelectorAll(".workspace-item-contexts");
  for (let i = 0; i < oldMenuItems.length; i++) {
    oldMenuItems[i].remove();
  }

  let menuitemElem = window.MozXULElement.parseXULToFragment(`
  <menuitem class="workspace-item-contexts" id="workspace-item-context-rename" data-l10n-id="workspace-rename" oncommand="renameWorkspace('${e.explicitOriginalTarget.getAttribute("label")}')"/>
  `);
  document.getElementById("workspace-item-context").appendChild(menuitemElem);
}

function renameWorkspace(label) {
  let prompts = Services.prompt;
  let l10n = new Localization(["browser/floorp.ftl"], true);
  let check = {value: false};
  let pattern = /^[\p{L}\p{N}]+$/u;
  let input = {value: ""};
  let result = prompts.prompt(null, l10n.formatValueSync("workspace-prompt-title"), l10n.formatValueSync("please-enter-workspace-name") + "\n" + l10n.formatValueSync("please-enter-workspace-name-2"), input, null, check);

  if (result && input.value != "" && input.value.length < 20 && input.value != l10n.formatValueSync("workspace-default") && pattern.test(input.value)) {
    let workspaceAll = Services.prefs.getStringPref(WORKSPACE_ALL_PREF).split(",");
    let index = workspaceAll.indexOf(label);
    workspaceAll[index] = input.value;
    Services.prefs.setStringPref(WORKSPACE_ALL_PREF, workspaceAll);

    //Tabs
    let tabs = gBrowser.tabs;
    for (let i = 0; i < tabs.length; i++) {
      let tab = tabs[i];
      if (tab.getAttribute("floorp-workspace") == label) {
        tab.setAttribute("floorp-workspace", input.value);
      }
    }
    saveWorkspaceState();

    //lastShowWorkspaceTab
    document.querySelector(`[lastShowWorkspaceTab-${label}]`)?.setAttribute(`lastShowWorkspaceTab-${input.value}`, "true");

    //menuitem
    let menuitem = document.querySelector(`#workspace-box-${label}`);
    let nextAfterMenuitem = menuitem.nextSibling;

    menuitem.remove();
    addWorkspaceElemToMenu(input.value, nextAfterMenuitem);

    let currentWorkspace = Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);

    if (currentWorkspace == label) {
      Services.prefs.setStringPref(WORKSPACE_CURRENT_PREF, input.value);
    }
  } else if(result == false){
    return;
  }
}

// tab context menu (move tab to other workspace)
function addContextMenuToTabContext() {
  let beforeElem = document.getElementById("context_moveTabOptions")
  let menuitemElem = window.MozXULElement.parseXULToFragment(`
  <menu id="context_MoveOtherWorkspace" data-l10n-id="move-tab-another-workspace" accesskey="D">
      <menupopup id="workspaceTabContextMenu"
                 onpopupshowing="CreateWorkspaceContextMenu();"/>
  </menu>
  `);
  beforeElem.before(menuitemElem);
}
addContextMenuToTabContext();

function checkTabsLength(){
  let tabs = gBrowser.tabs;
  for(let i = 0; i < tabs.length; i++){
    if(TabContextMenu.contextTab.getAttribute("firstVisibleTab") == "true"){
      document.getElementById("context_MoveOtherWorkspace").setAttribute("disabled", "true");
    }
  }
}

function CreateWorkspaceContextMenu(){
  //delete already exsist items
  let menuElem = document.getElementById("workspaceTabContextMenu");
  while(menuElem.firstChild){
    menuElem.removeChild(menuElem.firstChild);
  }

  //Rebuild context menu
  if(getNextToWorkspaceTab() == null){
    let menuItem = window.MozXULElement.parseXULToFragment(`
     <menuitem data-l10n-id="workspace-context-menu-selected-tab" disabled="true"/>
    `)
    let parentElem = document.getElementById("workspaceTabContextMenu");
    parentElem.appendChild(menuItem);
    return;
  }

  let workspaceAll = Services.prefs.getStringPref(WORKSPACE_ALL_PREF).split(",");
  for(let i = 0; i < workspaceAll.length; i++){
    let workspace = workspaceAll[i]
    let menuItem = window.MozXULElement.parseXULToFragment(`
      <menuitem id="workspaceID-${workspace}" class="workspaceContextMenuItems"
                label="${workspace}"  oncommand="moveTabToOtherWorkspace(TabContextMenu.contextTab, '${workspace}');"/>
    `)
    let parentElem = document.getElementById("workspaceTabContextMenu");
    if(workspace != TabContextMenu.contextTab.getAttribute("floorp-workspace")){
      parentElem.appendChild(menuItem);
    }
  }
}

function moveTabToOtherWorkspace(tab, workspace){
  //checkTabisCurrentTab
  if(tab == gBrowser.selectedTab && getNextToWorkspaceTab() != null){
    gBrowser.selectedTab = getNextToWorkspaceTab();
  }

  let willMoveWorkspace = workspace;
  tab.setAttribute("floorp-workspace", willMoveWorkspace);
  saveWorkspaceState();
  setCurrentWorkspace();
}

function addLastShowedWorkspaceTab(){
    //add lastShowWorkspaceTab
    let currentTab = gBrowser.selectedTab;
    let currentWorkspace = Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);

    document.querySelector(`[lastShowWorkspaceTab-${currentWorkspace}]`)?.removeAttribute(`lastShowWorkspaceTab-${currentWorkspace}`)
    currentTab.setAttribute(`lastShowWorkspaceTab-${currentWorkspace}`,"true")
}

function setMenuItemCheckCSS() {
  let currentWorkspace = Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);
  document.getElementById("workspaceMenuItemCheckCSS")?.remove();
  
  let Tag = document.createElement("style");
  Tag.innerText = `
    .workspace-item[workspace="${currentWorkspace}"] > .toolbarbutton-icon {
      visibility: inherit !important;
    }
  `;
  Tag.setAttribute("id", "workspaceMenuItemCheckCSS");
  document.head.appendChild(Tag);
}

function handleTabOpen() {
  let tabs = gBrowser.tabs;
  let lastTab = null;
  let firstTab = null;
  
  document.querySelector(`[floorp-lastVisibleTab]`)?.removeAttribute("floorp-lastVisibleTab");
  document.querySelector(`[floorp-firstVisibleTab]`)?.removeAttribute("floorp-firstVisibleTab");
  
  for (let i = 0; i < tabs.length; i++) {
    let tab = tabs[i];
    if (!tab.hasAttribute("floorp-workspace")) {
      tab.setAttribute("floorp-workspace", Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF));
    }
    if (tab.getAttribute("floorp-workspace") == Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF)) {
      lastTab = tab;
    }
    if (tab.getAttribute("floorp-workspace") == Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF) && firstTab == null) {
      tab.setAttribute("floorp-firstVisibleTab", "true");
      firstTab = tab;
    }
  }
  
  lastTab?.setAttribute("floorp-lastVisibleTab", "true");
  saveWorkspaceState();
}

function handleTabClose() {
  saveWorkspaceState();
  
  window.setTimeout(() => {
    document.querySelector(`[floorp-firstVisibleTab]`)?.removeAttribute("floorp-firstVisibleTab");
    document.querySelector(`[floorp-lastVisibleTab]`)?.removeAttribute("floorp-lastVisibleTab");
    document.querySelector(`tab:not([hidden])`).setAttribute("floorp-firstVisibleTab", "true");
    let elems = document.querySelectorAll(`tab:not([hidden])`);
    elems[elems.length - 1].setAttribute("floorp-lastVisibleTab", "true");
  }, 400);
}

function handleTabMove() {
  saveWorkspaceState();
  document.querySelector(`[floorp-firstVisibleTab]`)?.removeAttribute("floorp-firstVisibleTab");
  document.querySelector(`[floorp-lastVisibleTab]`)?.removeAttribute("floorp-lastVisibleTab");
  document.querySelector(`tab:not([hidden])`).setAttribute("floorp-firstVisibleTab", "true");
  let elems = document.querySelectorAll(`tab:not([hidden])`);
  elems[elems.length - 1].setAttribute("floorp-lastVisibleTab", "true");
}

function handleWorkspacePrefChange() {
  setCurrentWorkspace();
  setMenuItemCheckCSS()
}

function handleTabSelect() {
  setCurrentWorkspace();
  addLastShowedWorkspaceTab();
}

function handleWorkspaceTabPrefChange() {
  document.querySelector("#workspace-button").style.display = Services.prefs.getBoolPref(WORKSPACE_TAB_ENABLED_PREF) ? "" : "none";
  if (!Services.prefs.getBoolPref(WORKSPACE_TAB_ENABLED_PREF)) {
    document.querySelector(`[floorp-firstVisibleTab]`)?.removeAttribute("floorp-firstVisibleTab");
    document.querySelector(`[floorp-lastVisibleTab]`)?.removeAttribute("floorp-lastVisibleTab");
  }
  setCurrentWorkspace(); // Add event listeners
}

function changeWorkspaceToBeforeNext() {
  let currentWorkspace = Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);
  let workspaceAll = Services.prefs.getStringPref(WORKSPACE_ALL_PREF).split(",");
  let index = workspaceAll.indexOf(currentWorkspace);
  if (index == 0) {
    return;
  }
  let beforeWorkspace = workspaceAll[index - 1];
  changeWorkspace(beforeWorkspace);
  setCurrentWorkspace();
}

function changeWorkspaceToAfterNext() {
  let currentWorkspace = Services.prefs.getStringPref(WORKSPACE_CURRENT_PREF);
  let workspaceAll = Services.prefs.getStringPref(WORKSPACE_ALL_PREF).split(",");
  let index = workspaceAll.indexOf(currentWorkspace);
  if (index == workspaceAll.length - 1) {
    return;
  }
  let afterWorkspace = workspaceAll[index + 1];
  changeWorkspace(afterWorkspace);
  setCurrentWorkspace();
}

function handle_keydown(event) {
  if (event.shiftKey && event.key === 'ArrowUp') {
    changeWorkspaceToBeforeNext();
  }

  if (event.shiftKey && event.key === 'ArrowDown') {
    changeWorkspaceToAfterNext();
  }
}

window.setTimeout(function(){
  let list = Services.wm.getEnumerator("navigator:browser");
  while (list.hasMoreElements()) { if (list.getNext() != window) return; }
  
  const toolbarButtonEle = window.MozXULElement.parseXULToFragment(
    `
    <toolbarbutton id="workspace-button"
                    class="toolbarbutton-1 chromeclass-toolbar-additional"
                    label="Workspace"
                    tooltiptext="Workspace"
                    type="menu"
                    style="list-style-image: url('chrome://browser/skin/workspace-floorp.png');">
      <menupopup id="workspace-menu" context="workspace-menu-context">
        <toolbarbutton style="list-style-image: url('chrome://global/skin/icons/plus.svg');"
                id="addNewWorkspaceButton"        data-l10n-id="workspace-add" class="subviewbutton subviewbutton-nav" oncommand="addNewWorkspace()"/>
      </menupopup>
    </toolbarbutton>
    `
  );
  document.querySelector(".toolbar-items").before(toolbarButtonEle);
  if(!Services.prefs.getBoolPref(WORKSPACE_TAB_ENABLED_PREF)) document.querySelector("#workspace-button").style.display = "none"

  //run codes
  initWorkspace();
  setCurrentWorkspace();

  gBrowser.tabContainer.addEventListener("TabOpen", handleTabOpen, false);
  gBrowser.tabContainer.addEventListener("TabClose", handleTabClose, false);
  gBrowser.tabContainer.addEventListener("TabMove", handleTabMove, false);
  gBrowser.tabContainer.addEventListener("TabSelect", handleTabSelect, false);

  Services.prefs.addObserver(WORKSPACE_CURRENT_PREF, handleWorkspacePrefChange, false);
  Services.prefs.addObserver(WORKSPACE_TAB_ENABLED_PREF, handleWorkspaceTabPrefChange, false);

  document.addEventListener('keydown', handle_keydown, false);
}, 1000);
