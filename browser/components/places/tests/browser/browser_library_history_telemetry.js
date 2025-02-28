/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { TelemetryTestUtils } = ChromeUtils.import(
  "resource://testing-common/TelemetryTestUtils.jsm"
);

// Visited pages listed by descending visit date.
const pages = [
  "https://library.mozilla.org/a",
  "https://library.mozilla.org/b",
  "https://library.mozilla.org/c",
  "https://www.mozilla.org/d",
];

// The prompt returns 1 for cancelled and 0 for accepted.
let gResponse = 1;
(function replacePromptService() {
  let originalPromptService = Services.prompt;
  Services.prompt = {
    QueryInterface: ChromeUtils.generateQI([Ci.nsIPromptService]),
    confirmEx: () => gResponse,
  };
  registerCleanupFunction(() => {
    Services.prompt = originalPromptService;
  });
})();

async function searchHistory(gLibrary, searchTerm) {
  let doc = gLibrary.document;
  let contentTree = doc.getElementById("placeContent");

  let searchBox = doc.getElementById("searchFilter");
  searchBox.value = searchTerm;
  gLibrary.PlacesSearchBox.search(searchBox.value);
  let query = {};
  PlacesUtils.history.queryStringToQuery(
    contentTree.result.root.uri,
    query,
    {}
  );
  Assert.equal(
    query.value.searchTerms,
    searchTerm,
    "Content tree's searchTerms should be text in search box"
  );
}

add_setup(async function() {
  await PlacesUtils.history.clear();
  // Add some visited pages to history
  let time = Date.now();
  let places = [];
  for (let i = 0; i < pages.length; i++) {
    places.push({
      uri: NetUtil.newURI(pages[i]),
      visitDate: (time - i) * 1000,
      transition: PlacesUtils.history.TRANSITION_TYPED,
    });
  }
  await PlacesTestUtils.addVisits(places);

  await registerCleanupFunction(async () => {
    await PlacesUtils.history.clear();
  });
});

add_task(async function test_library_history_telemetry() {
  Services.telemetry.clearScalars();
  let cumulativeSearchesHistogram = Services.telemetry.getHistogramById(
    "PLACES_LIBRARY_CUMULATIVE_HISTORY_SEARCHES"
  );

  let gLibrary = await promiseLibrary("History");

  TelemetryTestUtils.assertKeyedScalar(
    TelemetryTestUtils.getProcessScalars("parent", true, true),
    "library.opened",
    "history",
    1
  );

  let currentSelectedLeftPaneNode =
    gLibrary.PlacesOrganizer._places.selectedNode;
  if (
    currentSelectedLeftPaneNode.title == "History" &&
    currentSelectedLeftPaneNode.hasChildren &&
    currentSelectedLeftPaneNode.getChild(0).title == "Today"
  ) {
    // Select "Today" node under History if not already selected
    gLibrary.PlacesOrganizer._places.selectNode(
      currentSelectedLeftPaneNode.getChild(0)
    );
  }

  Assert.equal(
    gLibrary.PlacesOrganizer._places.selectedNode.title,
    "Today",
    "The Today history sidebar button is selected"
  );

  await searchHistory(gLibrary, "mozilla");

  TelemetryTestUtils.assertKeyedScalar(
    TelemetryTestUtils.getProcessScalars("parent", true, true),
    "library.search",
    "history",
    1
  );

  let firstHistoryNode = gLibrary.ContentTree.view.view.nodeForTreeIndex(0);
  Assert.equal(
    firstHistoryNode.uri,
    pages[0],
    "Found history item in the right pane"
  );

  // Double click first History link to open it
  gLibrary.ContentTree.view.selectNode(firstHistoryNode);
  synthesizeClickOnSelectedTreeCell(gLibrary.ContentTree.view, {
    clickCount: 2,
  });

  TelemetryTestUtils.assertKeyedScalar(
    TelemetryTestUtils.getProcessScalars("parent", true, true),
    "library.link",
    "history",
    1
  );

  TelemetryTestUtils.assertHistogram(cumulativeSearchesHistogram, 1, 1);
  info("Cumulative search telemetry looks right");

  cumulativeSearchesHistogram.clear();

  // Close and reopen Libary window
  await promiseLibraryClosed(gLibrary);
  gLibrary = await promiseLibrary("History");

  Assert.equal(
    gLibrary.PlacesOrganizer._places.selectedNode.title,
    "Today",
    "The Today history sidebar button is selected"
  );

  // if a user tries to open all history entries and they cancel opening
  // those entries in new tabs (due to max tab limit warning),
  // no telemetry should be recorded
  await SpecialPowers.pushPrefEnv({
    set: [["browser.tabs.maxOpenBeforeWarn", 4]],
  });

  // Reject opening all tabs when prompted
  gResponse = 1;

  // Open all history entries
  synthesizeClickOnSelectedTreeCell(gLibrary.PlacesOrganizer._places, {
    button: 1,
  });

  TelemetryTestUtils.assertScalarUnset(
    TelemetryTestUtils.getProcessScalars("parent", true, true),
    "library.link"
  );

  // Make 4 searches before opening History links
  await searchHistory(gLibrary, "library a", 1);
  info("First search was performed.");
  await searchHistory(gLibrary, "library b", 2);
  info("Second search was performed.");
  await searchHistory(gLibrary, "library c", 3);
  info("Third search was performed.");
  await searchHistory(gLibrary, "mozilla", 4);
  info("Fourth search was performed.");

  TelemetryTestUtils.assertKeyedScalar(
    TelemetryTestUtils.getProcessScalars("parent", true, true),
    "library.search",
    "history",
    4
  );

  // Accept opening all tabs when prompted
  gResponse = 0;

  // Open all history entries
  synthesizeClickOnSelectedTreeCell(gLibrary.PlacesOrganizer._places, {
    button: 1,
  });

  TelemetryTestUtils.assertKeyedScalar(
    TelemetryTestUtils.getProcessScalars("parent", true, true),
    "library.link",
    "history",
    4
  );

  TelemetryTestUtils.assertHistogram(cumulativeSearchesHistogram, 4, 1);
  info("Cumulative search telemetry looks right");

  cumulativeSearchesHistogram.clear();
  await promiseLibraryClosed(gLibrary);
  await SpecialPowers.popPrefEnv();

  while (gBrowser.tabs.length > 1) {
    BrowserTestUtils.removeTab(gBrowser.selectedTab);
  }
});
