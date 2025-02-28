/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.defineESModuleGetters(this, {
  SearchTestUtils: "resource://testing-common/SearchTestUtils.sys.mjs",
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
});

const CONFIG_DEFAULT = [
  {
    webExtension: { id: "basic@search.mozilla.org" },
    urls: {
      trending: {
        fullPath:
          "http://mochi.test:8888/browser/browser/components/urlbar/tests/browser/searchSuggestionEngine.sjs",
        query: "",
      },
    },
    appliesTo: [{ included: { everywhere: true } }],
    default: "yes",
  },
  {
    webExtension: { id: "private@search.mozilla.org" },
    appliesTo: [{ included: { everywhere: true } }],
    default: "yes",
  },
];

SearchTestUtils.init(this);
UrlbarTestUtils.init(this);

add_setup(async () => {
  // Use engines in test directory
  let searchExtensions = getChromeDir(getResolvedURI(gTestPath));
  searchExtensions.append("search-engines");
  await SearchTestUtils.useMochitestEngines(searchExtensions);

  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.suggest.searches", true]],
  });

  SearchTestUtils.useMockIdleService();
  await SearchTestUtils.updateRemoteSettingsConfig(CONFIG_DEFAULT);

  registerCleanupFunction(async () => {
    let settingsWritten = SearchTestUtils.promiseSearchNotification(
      "write-settings-to-disk-complete"
    );
    await SearchTestUtils.updateRemoteSettingsConfig();
    await settingsWritten;
  });
});

add_task(async function test_trending_results() {
  await check_results({
    featureEnabled: true,
    searchMode: "@basic ",
    expectedResults: 2,
  });
  await check_results({
    featureEnabled: true,
    requireSearchModeEnabled: false,
    expectedResults: 2,
  });
  await check_results({
    featureEnabled: true,
    requireSearchModeEnabled: false,
    searchMode: "@basic ",
    expectedResults: 2,
  });
  await check_results({
    featureEnabled: false,
    searchMode: "@basic ",
    expectedResults: 0,
  });
  await check_results({
    featureEnabled: false,
    expectedResults: 0,
  });
  await check_results({
    featureEnabled: false,
    requireSearchModeEnabled: false,
    expectedResults: 0,
  });
  await check_results({
    featureEnabled: false,
    requireSearchModeEnabled: false,
    searchMode: "@basic ",
    expectedResults: 0,
  });

  // The private engine is not configured with any trending url.
  await check_results({
    featureEnabled: true,
    searchMode: "@private ",
    expectedResults: 0,
  });
});

async function check_results({
  featureEnabled = false,
  requireSearchModeEnabled = true,
  searchMode = "",
  expectedResults = 0,
}) {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.urlbar.trending.featureGate", featureEnabled],
      ["browser.urlbar.trending.requireSearchMode", requireSearchModeEnabled],
    ],
  });

  // If we are not in a search mode and there are no results. The urlbar
  // will not open.
  if (!searchMode && !expectedResults) {
    window.gURLBar.inputField.focus();
    Assert.ok(!UrlbarTestUtils.isPopupOpen(window));
    return;
  }

  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: searchMode,
    waitForFocus: SimpleTest.waitForFocus,
  });

  Assert.equal(
    UrlbarTestUtils.getResultCount(window),
    expectedResults,
    "We matched the expected number of results"
  );

  if (expectedResults) {
    for (let i = 0; i < expectedResults; i++) {
      let { result } = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
      Assert.equal(result.type, UrlbarUtils.RESULT_TYPE.SEARCH);
      Assert.equal(result.providerName, "SearchSuggestions");
      Assert.equal(result.payload.engine, "basic");
    }
  }

  if (searchMode) {
    await UrlbarTestUtils.exitSearchMode(window);
  }
  await UrlbarTestUtils.promisePopupClose(window, () => {
    EventUtils.synthesizeKey("KEY_Escape");
  });
  await SpecialPowers.popPrefEnv();
}
