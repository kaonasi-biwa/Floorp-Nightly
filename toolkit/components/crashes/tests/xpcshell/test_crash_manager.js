/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { CrashManager } = ChromeUtils.import(
  "resource://gre/modules/CrashManager.jsm"
);
const { TelemetryArchiveTesting } = ChromeUtils.importESModule(
  "resource://testing-common/TelemetryArchiveTesting.sys.mjs"
);
const { configureLogging, getManager, sleep } = ChromeUtils.import(
  "resource://testing-common/CrashManagerTest.jsm"
);
const { TelemetryEnvironment } = ChromeUtils.importESModule(
  "resource://gre/modules/TelemetryEnvironment.sys.mjs"
);

const DUMMY_DATE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
DUMMY_DATE.setMilliseconds(0);

const DUMMY_DATE_2 = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
DUMMY_DATE_2.setMilliseconds(0);

function run_test() {
  do_get_profile();
  configureLogging();
  TelemetryArchiveTesting.setup();
  // Initialize FOG for glean tests
  Services.fog.initializeFOG();
  run_next_test();
}

add_task(async function test_constructor_ok() {
  let m = new CrashManager({
    pendingDumpsDir: "/foo",
    submittedDumpsDir: "/bar",
    eventsDirs: [],
    storeDir: "/baz",
  });
  Assert.ok(m, "CrashManager can be created.");
});

add_task(async function test_constructor_invalid() {
  Assert.throws(() => {
    new CrashManager({ foo: true });
  }, /Unknown property in options/);
});

add_task(async function test_get_manager() {
  let m = await getManager();
  Assert.ok(m, "CrashManager obtained.");

  await m.createDummyDump(true);
  await m.createDummyDump(false);
});

add_task(async function test_valid_process() {
  let m = await getManager();
  Assert.ok(m, "CrashManager obtained.");

  Assert.ok(!m.isValidProcessType(42));
  Assert.ok(!m.isValidProcessType(null));
  Assert.ok(!m.isValidProcessType("default"));

  Assert.ok(m.isValidProcessType("main"));
});

add_task(async function test_process_ping() {
  let m = await getManager();
  Assert.ok(m, "CrashManager obtained.");

  Assert.ok(!m.isPingAllowed(42));
  Assert.ok(!m.isPingAllowed(null));
  Assert.ok(!m.isPingAllowed("default"));
  Assert.ok(!m.isPingAllowed("ipdlunittest"));
  Assert.ok(!m.isPingAllowed("tab"));

  Assert.ok(m.isPingAllowed("content"));
  Assert.ok(m.isPingAllowed("forkserver"));
  Assert.ok(m.isPingAllowed("gmplugin"));
  Assert.ok(m.isPingAllowed("gpu"));
  Assert.ok(m.isPingAllowed("main"));
  Assert.ok(m.isPingAllowed("rdd"));
  Assert.ok(m.isPingAllowed("sandboxbroker"));
  Assert.ok(m.isPingAllowed("socket"));
  Assert.ok(m.isPingAllowed("utility"));
  Assert.ok(m.isPingAllowed("vr"));
});

// Unsubmitted dump files on disk are detected properly.
add_task(async function test_pending_dumps() {
  let m = await getManager();
  let now = Date.now();
  let ids = [];
  const COUNT = 5;

  for (let i = 0; i < COUNT; i++) {
    ids.push(await m.createDummyDump(false, new Date(now - i * 86400000)));
  }
  await m.createIgnoredDumpFile("ignored", false);

  let entries = await m.pendingDumps();
  Assert.equal(entries.length, COUNT, "proper number detected.");

  for (let entry of entries) {
    Assert.equal(typeof entry, "object", "entry is an object");
    Assert.ok("id" in entry, "id in entry");
    Assert.ok("path" in entry, "path in entry");
    Assert.ok("date" in entry, "date in entry");
    Assert.notEqual(ids.indexOf(entry.id), -1, "ID is known");
  }

  for (let i = 0; i < COUNT; i++) {
    Assert.equal(entries[i].id, ids[COUNT - i - 1], "Entries sorted by mtime");
  }
});

// Submitted dump files on disk are detected properly.
add_task(async function test_submitted_dumps() {
  let m = await getManager();
  let COUNT = 5;

  for (let i = 0; i < COUNT; i++) {
    await m.createDummyDump(true);
  }
  await m.createIgnoredDumpFile("ignored", true);

  let entries = await m.submittedDumps();
  Assert.equal(entries.length, COUNT, "proper number detected.");

  let hrID = await m.createDummyDump(true, new Date(), true);
  entries = await m.submittedDumps();
  Assert.equal(entries.length, COUNT + 1, "hr- in filename detected.");

  let gotIDs = new Set(entries.map(e => e.id));
  Assert.ok(gotIDs.has(hrID));
});

// The store should expire after inactivity.
add_task(async function test_store_expires() {
  let m = await getManager();

  Object.defineProperty(m, "STORE_EXPIRATION_MS", {
    value: 250,
  });

  let store = await m._getStore();
  Assert.ok(store);
  Assert.equal(store, m._store);

  await sleep(300);
  Assert.ok(!m._store, "Store has gone away.");
});

// Ensure errors are handled when the events dir is missing.
add_task(async function test_empty_events_dir() {
  let m = await getManager();
  await m.deleteEventsDirs();

  let paths = await m._getUnprocessedEventsFiles();
  Assert.equal(paths.length, 0);
});

// Ensure discovery of unprocessed events files works.
add_task(async function test_unprocessed_events_files() {
  let m = await getManager();
  await m.createEventsFile("1", "test.1", new Date(), "foo", "{}", 0);
  await m.createEventsFile("2", "test.1", new Date(), "bar", "{}", 0);
  await m.createEventsFile("1", "test.1", new Date(), "baz", "{}", 1);

  let paths = await m._getUnprocessedEventsFiles();
  Assert.equal(paths.length, 3);
});

// Ensure only 1 aggregateEventsFiles() is allowed at a time.
add_task(async function test_aggregate_events_locking() {
  let m = await getManager();

  let p1 = m.aggregateEventsFiles();
  let p2 = m.aggregateEventsFiles();

  Assert.strictEqual(p1, p2, "Same promise should be returned.");
});

// Malformed events files should be deleted.
add_task(async function test_malformed_files_deleted() {
  let m = await getManager();

  await m.createEventsFile("1", "crash.main.1", new Date(), "foo\nbar");

  let count = await m.aggregateEventsFiles();
  Assert.equal(count, 1);
  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 0);

  count = await m.aggregateEventsFiles();
  Assert.equal(count, 0);
});

// Unknown event types should be ignored.
add_task(async function test_aggregate_ignore_unknown_events() {
  let m = await getManager();

  await m.createEventsFile("1", "crash.main.3", DUMMY_DATE, "id1", "{}");
  await m.createEventsFile("2", "foobar.1", new Date(), "dummy");

  let count = await m.aggregateEventsFiles();
  Assert.equal(count, 2);

  count = await m.aggregateEventsFiles();
  Assert.equal(count, 1);

  count = await m.aggregateEventsFiles();
  Assert.equal(count, 1);
});

add_task(async function test_prune_old() {
  let m = await getManager();
  let oldDate = new Date(Date.now() - 86400000);
  let newDate = new Date(Date.now() - 10000);
  await m.createEventsFile("1", "crash.main.3", oldDate, "id1", "{}");
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
    m.CRASH_TYPE_CRASH,
    "id2",
    newDate
  );

  await m.aggregateEventsFiles();

  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 2);

  await m.pruneOldCrashes(new Date(oldDate.getTime() + 10000));

  crashes = await m.getCrashes();
  Assert.equal(crashes.length, 1, "Old crash has been pruned.");

  let c = crashes[0];
  Assert.equal(c.id, "id2", "Proper crash was pruned.");

  // We can't test exact boundary conditions because dates from filesystem
  // don't have same guarantees as JS dates.
  await m.pruneOldCrashes(new Date(newDate.getTime() + 5000));
  crashes = await m.getCrashes();
  Assert.equal(crashes.length, 0);
});

add_task(async function test_schedule_maintenance() {
  let m = await getManager();
  await m.createEventsFile("1", "crash.main.3", DUMMY_DATE, "id1", "{}");

  let oldDate = new Date(
    Date.now() - m.PURGE_OLDER_THAN_DAYS * 2 * 24 * 60 * 60 * 1000
  );
  await m.createEventsFile("2", "crash.main.3", oldDate, "id2", "{}");

  await m.scheduleMaintenance(25);
  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 1);
  Assert.equal(crashes[0].id, "id1");
});

const crashId = "3cb67eba-0dc7-6f78-6a569a0e-172287ec";
const productName = "Firefox";
const productId = "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}";
const sha256Hash =
  "f8410c3ac4496cfa9191a1240f0e365101aef40c7bf34fc5bcb8ec511832ed79";
const stackTraces = { status: "OK" };

add_task(async function test_main_crash_event_file() {
  let ac = new TelemetryArchiveTesting.Checker();
  await ac.promiseInit();
  let theEnvironment = TelemetryEnvironment.currentEnvironment;
  const sessionId = "be66af2f-2ee5-4330-ae95-44462dfbdf0c";

  // To test proper escaping, add data to the environment with an embedded
  // double-quote
  theEnvironment.testValue = 'MyValue"';

  let m = await getManager();
  const metadata = JSON.stringify({
    ProductName: productName,
    ProductID: productId,
    TelemetryEnvironment: JSON.stringify(theEnvironment),
    TelemetrySessionId: sessionId,
    MinidumpSha256Hash: sha256Hash,
    StackTraces: stackTraces,
    ThisShouldNot: "end-up-in-the-ping",
  });

  await m.createEventsFile(
    crashId,
    "crash.main.3",
    DUMMY_DATE,
    crashId,
    metadata
  );
  let count = await m.aggregateEventsFiles();
  Assert.equal(count, 1);

  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 1);
  Assert.equal(crashes[0].id, crashId);
  Assert.equal(crashes[0].type, "main-crash");
  Assert.equal(crashes[0].metadata.ProductName, productName);
  Assert.equal(crashes[0].metadata.ProductID, productId);
  Assert.ok(crashes[0].metadata.TelemetryEnvironment);
  Assert.equal(Object.getOwnPropertyNames(crashes[0].metadata).length, 7);
  Assert.equal(crashes[0].metadata.TelemetrySessionId, sessionId);
  Assert.ok(crashes[0].metadata.StackTraces);
  Assert.deepEqual(crashes[0].crashDate, DUMMY_DATE);

  let found = await ac.promiseFindPing("crash", [
    [["payload", "hasCrashEnvironment"], true],
    [["payload", "metadata", "ProductName"], productName],
    [["payload", "metadata", "ProductID"], productId],
    [["payload", "minidumpSha256Hash"], sha256Hash],
    [["payload", "crashId"], crashId],
    [["payload", "stackTraces", "status"], "OK"],
    [["payload", "sessionId"], sessionId],
  ]);
  Assert.ok(found, "Telemetry ping submitted for found crash");
  Assert.deepEqual(
    found.environment,
    theEnvironment,
    "The saved environment should be present"
  );
  Assert.equal(
    found.payload.metadata.ThisShouldNot,
    undefined,
    "Non-allowlisted fields should be filtered out"
  );

  count = await m.aggregateEventsFiles();
  Assert.equal(count, 0);
});

add_task(async function test_main_crash_event_file_noenv() {
  let ac = new TelemetryArchiveTesting.Checker();
  await ac.promiseInit();
  const metadata = JSON.stringify({
    ProductName: productName,
    ProductID: productId,
  });

  let m = await getManager();
  await m.createEventsFile(
    crashId,
    "crash.main.3",
    DUMMY_DATE,
    crashId,
    metadata
  );
  let count = await m.aggregateEventsFiles();
  Assert.equal(count, 1);

  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 1);
  Assert.equal(crashes[0].id, crashId);
  Assert.equal(crashes[0].type, "main-crash");
  Assert.deepEqual(crashes[0].metadata, {
    ProductName: productName,
    ProductID: productId,
  });
  Assert.deepEqual(crashes[0].crashDate, DUMMY_DATE);

  let found = await ac.promiseFindPing("crash", [
    [["payload", "hasCrashEnvironment"], false],
    [["payload", "metadata", "ProductName"], productName],
    [["payload", "metadata", "ProductID"], productId],
  ]);
  Assert.ok(found, "Telemetry ping submitted for found crash");
  Assert.ok(found.environment, "There is an environment");

  count = await m.aggregateEventsFiles();
  Assert.equal(count, 0);
});

add_task(async function test_crash_submission_event_file() {
  let m = await getManager();
  await m.createEventsFile("1", "crash.main.3", DUMMY_DATE, "crash1", "{}");
  await m.createEventsFile(
    "1-submission",
    "crash.submission.1",
    DUMMY_DATE_2,
    "crash1",
    "false\n"
  );

  // The line below has been intentionally commented out to make sure that
  // the crash record is created when one does not exist.
  // yield m.createEventsFile("2", "crash.main.1", DUMMY_DATE, "crash2");
  await m.createEventsFile(
    "2-submission",
    "crash.submission.1",
    DUMMY_DATE_2,
    "crash2",
    "true\nbp-2"
  );
  let count = await m.aggregateEventsFiles();
  Assert.equal(count, 3);

  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 2);

  let map = new Map(crashes.map(crash => [crash.id, crash]));

  let crash1 = map.get("crash1");
  Assert.ok(!!crash1);
  Assert.equal(crash1.remoteID, null);
  let crash2 = map.get("crash2");
  Assert.ok(!!crash2);
  Assert.equal(crash2.remoteID, "bp-2");

  Assert.equal(crash1.submissions.size, 1);
  let submission = crash1.submissions.values().next().value;
  Assert.equal(submission.result, m.SUBMISSION_RESULT_FAILED);
  Assert.equal(submission.requestDate.getTime(), DUMMY_DATE_2.getTime());
  Assert.equal(submission.responseDate.getTime(), DUMMY_DATE_2.getTime());

  Assert.equal(crash2.submissions.size, 1);
  submission = crash2.submissions.values().next().value;
  Assert.equal(submission.result, m.SUBMISSION_RESULT_OK);
  Assert.equal(submission.requestDate.getTime(), DUMMY_DATE_2.getTime());
  Assert.equal(submission.responseDate.getTime(), DUMMY_DATE_2.getTime());

  count = await m.aggregateEventsFiles();
  Assert.equal(count, 0);
});

add_task(async function test_multiline_crash_id_rejected() {
  let m = await getManager();
  await m.createEventsFile("1", "crash.main.1", DUMMY_DATE, "id1\nid2");
  await m.aggregateEventsFiles();
  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 0);
});

// Main process crashes should be remembered beyond the high water mark.
add_task(async function test_high_water_mark() {
  let m = await getManager();

  let store = await m._getStore();

  for (let i = 0; i < store.HIGH_WATER_DAILY_THRESHOLD + 1; i++) {
    await m.createEventsFile(
      "m" + i,
      "crash.main.3",
      DUMMY_DATE,
      "m" + i,
      "{}"
    );
  }

  let count = await m.aggregateEventsFiles();
  Assert.equal(count, store.HIGH_WATER_DAILY_THRESHOLD + 1);

  // Need to fetch again in case the first one was garbage collected.
  store = await m._getStore();

  Assert.equal(store.crashesCount, store.HIGH_WATER_DAILY_THRESHOLD + 1);
});

add_task(async function test_addCrash() {
  let m = await getManager();

  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 0);

  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
    m.CRASH_TYPE_CRASH,
    "main-crash",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
    m.CRASH_TYPE_HANG,
    "main-hang",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
    m.CRASH_TYPE_CRASH,
    "content-crash",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
    m.CRASH_TYPE_HANG,
    "content-hang",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_GMPLUGIN],
    m.CRASH_TYPE_CRASH,
    "gmplugin-crash",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_GPU],
    m.CRASH_TYPE_CRASH,
    "gpu-crash",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_VR],
    m.CRASH_TYPE_CRASH,
    "vr-crash",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_RDD],
    m.CRASH_TYPE_CRASH,
    "rdd-crash",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_SOCKET],
    m.CRASH_TYPE_CRASH,
    "socket-crash",
    DUMMY_DATE
  );

  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
    m.CRASH_TYPE_CRASH,
    "changing-item",
    DUMMY_DATE
  );
  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
    m.CRASH_TYPE_HANG,
    "changing-item",
    DUMMY_DATE_2
  );

  crashes = await m.getCrashes();
  Assert.equal(crashes.length, 10);

  let map = new Map(crashes.map(crash => [crash.id, crash]));

  let crash = map.get("main-crash");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT] +
      "-" +
      m.CRASH_TYPE_CRASH
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
      m.CRASH_TYPE_CRASH
    )
  );

  crash = map.get("main-hang");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT] +
      "-" +
      m.CRASH_TYPE_HANG
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
      m.CRASH_TYPE_HANG
    )
  );

  crash = map.get("content-crash");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT] +
      "-" +
      m.CRASH_TYPE_CRASH
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
      m.CRASH_TYPE_CRASH
    )
  );

  crash = map.get("content-hang");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT] +
      "-" +
      m.CRASH_TYPE_HANG
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
      m.CRASH_TYPE_HANG
    )
  );

  crash = map.get("gmplugin-crash");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_GMPLUGIN] +
      "-" +
      m.CRASH_TYPE_CRASH
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_GMPLUGIN],
      m.CRASH_TYPE_CRASH
    )
  );

  crash = map.get("gpu-crash");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_GPU] + "-" + m.CRASH_TYPE_CRASH
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_GPU],
      m.CRASH_TYPE_CRASH
    )
  );

  crash = map.get("vr-crash");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_VR] + "-" + m.CRASH_TYPE_CRASH
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_VR],
      m.CRASH_TYPE_CRASH
    )
  );

  crash = map.get("rdd-crash");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_RDD] + "-" + m.CRASH_TYPE_CRASH
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_RDD],
      m.CRASH_TYPE_CRASH
    )
  );

  crash = map.get("socket-crash");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_SOCKET] +
      "-" +
      m.CRASH_TYPE_CRASH
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_SOCKET],
      m.CRASH_TYPE_CRASH
    )
  );

  crash = map.get("changing-item");
  Assert.ok(!!crash);
  Assert.equal(crash.crashDate, DUMMY_DATE_2);
  Assert.equal(
    crash.type,
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT] +
      "-" +
      m.CRASH_TYPE_HANG
  );
  Assert.ok(
    crash.isOfType(
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
      m.CRASH_TYPE_HANG
    )
  );
});

add_task(async function test_child_process_crash_ping() {
  let m = await getManager();
  const EXPECTED_PROCESSES = [
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_GMPLUGIN],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_GPU],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_VR],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_RDD],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_SOCKET],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_REMOTESANDBOXBROKER],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_FORKSERVER],
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_UTILITY],
  ];

  const UNEXPECTED_PROCESSES = [
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_IPDLUNITTEST],
    null,
    12, // non-string process type
  ];

  let ac = new TelemetryArchiveTesting.Checker();
  await ac.promiseInit();

  // Add a child-process crash for each allowed process type.
  for (let p of EXPECTED_PROCESSES) {
    // Generate a ping.
    const remoteType =
      p === m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT]
        ? "web"
        : undefined;
    let id = await m.createDummyDump();
    await m.addCrash(p, m.CRASH_TYPE_CRASH, id, DUMMY_DATE, {
      RemoteType: remoteType,
      StackTraces: stackTraces,
      MinidumpSha256Hash: sha256Hash,
      ipc_channel_error: "ShutDownKill",
      ThisShouldNot: "end-up-in-the-ping",
    });
    await m._pingPromise;

    let found = await ac.promiseFindPing("crash", [
      [["payload", "crashId"], id],
      [["payload", "minidumpSha256Hash"], sha256Hash],
      [["payload", "processType"], p],
      [["payload", "stackTraces", "status"], "OK"],
    ]);
    Assert.ok(found, "Telemetry ping submitted for " + p + " crash");

    let hoursOnly = new Date(DUMMY_DATE);
    hoursOnly.setSeconds(0);
    hoursOnly.setMinutes(0);
    Assert.equal(
      new Date(found.payload.crashTime).getTime(),
      hoursOnly.getTime()
    );

    Assert.equal(
      found.payload.metadata.ThisShouldNot,
      undefined,
      "Non-allowlisted fields should be filtered out"
    );
    Assert.equal(
      found.payload.metadata.RemoteType,
      remoteType,
      "RemoteType should be allowlisted for content crashes"
    );
    Assert.equal(
      found.payload.metadata.ipc_channel_error,
      "ShutDownKill",
      "ipc_channel_error should be allowlisted for content crashes"
    );
  }

  // Check that we don't generate a crash ping for invalid/unexpected process
  // types.
  for (let p of UNEXPECTED_PROCESSES) {
    let id = await m.createDummyDump();
    await m.addCrash(p, m.CRASH_TYPE_CRASH, id, DUMMY_DATE, {
      StackTraces: stackTraces,
      MinidumpSha256Hash: sha256Hash,
      ThisShouldNot: "end-up-in-the-ping",
    });
    await m._pingPromise;

    // Check that we didn't receive any new ping.
    let found = await ac.promiseFindPing("crash", [
      [["payload", "crashId"], id],
    ]);
    Assert.ok(
      !found,
      "No telemetry ping must be submitted for invalid process types"
    );
  }
});

add_task(async function test_glean_crash_ping() {
  let m = await getManager();

  let id = await m.createDummyDump();

  // Test bare minumum (with missing optional fields)
  let submitted = false;
  GleanPings.crash.testBeforeNextSubmit(_ => {
    submitted = true;
    const MINUTES = new Date(DUMMY_DATE);
    MINUTES.setSeconds(0);
    Assert.equal(Glean.crash.time.testGetValue().getTime(), MINUTES.getTime());
    Assert.equal(
      Glean.crash.processType.testGetValue(),
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT]
    );
    Assert.equal(Glean.crash.startup.testGetValue(), false);
  });

  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
    m.CRASH_TYPE_CRASH,
    id,
    DUMMY_DATE,
    {}
  );

  Assert.ok(submitted);

  // Test with additional fields
  submitted = false;
  GleanPings.crash.testBeforeNextSubmit(reason => {
    submitted = true;
    const MINUTES = new Date(DUMMY_DATE_2);
    MINUTES.setSeconds(0);
    Assert.equal(Glean.crash.uptime.testGetValue(), 600.1 * 1000);
    Assert.equal(Glean.crash.time.testGetValue().getTime(), MINUTES.getTime());
    Assert.equal(
      Glean.crash.processType.testGetValue(),
      m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT]
    );
    Assert.equal(Glean.crash.startup.testGetValue(), true);
  });

  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_CONTENT],
    m.CRASH_TYPE_CRASH,
    id,
    DUMMY_DATE_2,
    {
      StackTraces: stackTraces,
      MinidumpSha256Hash: sha256Hash,
      UptimeTS: "600.1",
      StartupCrash: "1",
    }
  );

  Assert.ok(submitted);
});

add_task(async function test_generateSubmissionID() {
  let m = await getManager();

  const SUBMISSION_ID_REGEX = /^(sub-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  let id = m.generateSubmissionID();
  Assert.ok(SUBMISSION_ID_REGEX.test(id));
});

add_task(async function test_addSubmissionAttemptAndResult() {
  let m = await getManager();

  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 0);

  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
    m.CRASH_TYPE_CRASH,
    "main-crash",
    DUMMY_DATE
  );
  await m.addSubmissionAttempt("main-crash", "submission", DUMMY_DATE);
  await m.addSubmissionResult(
    "main-crash",
    "submission",
    DUMMY_DATE_2,
    m.SUBMISSION_RESULT_OK
  );

  crashes = await m.getCrashes();
  Assert.equal(crashes.length, 1);

  let submissions = crashes[0].submissions;
  Assert.ok(!!submissions);

  let submission = submissions.get("submission");
  Assert.ok(!!submission);
  Assert.equal(submission.requestDate.getTime(), DUMMY_DATE.getTime());
  Assert.equal(submission.responseDate.getTime(), DUMMY_DATE_2.getTime());
  Assert.equal(submission.result, m.SUBMISSION_RESULT_OK);
});

add_task(async function test_addSubmissionAttemptEarlyCall() {
  let m = await getManager();

  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 0);

  let p = m
    .ensureCrashIsPresent("main-crash")
    .then(() => {
      return m.addSubmissionAttempt("main-crash", "submission", DUMMY_DATE);
    })
    .then(() => {
      return m.addSubmissionResult(
        "main-crash",
        "submission",
        DUMMY_DATE_2,
        m.SUBMISSION_RESULT_OK
      );
    });

  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
    m.CRASH_TYPE_CRASH,
    "main-crash",
    DUMMY_DATE
  );

  crashes = await m.getCrashes();
  Assert.equal(crashes.length, 1);

  await p;
  let submissions = crashes[0].submissions;
  Assert.ok(!!submissions);

  let submission = submissions.get("submission");
  Assert.ok(!!submission);
  Assert.equal(submission.requestDate.getTime(), DUMMY_DATE.getTime());
  Assert.equal(submission.responseDate.getTime(), DUMMY_DATE_2.getTime());
  Assert.equal(submission.result, m.SUBMISSION_RESULT_OK);
});

add_task(async function test_setCrashClassifications() {
  let m = await getManager();

  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
    m.CRASH_TYPE_CRASH,
    "main-crash",
    DUMMY_DATE
  );
  await m.setCrashClassifications("main-crash", ["a"]);
  let classifications = (await m.getCrashes())[0].classifications;
  Assert.ok(classifications.includes("a"));
});

add_task(async function test_setRemoteCrashID() {
  let m = await getManager();

  await m.addCrash(
    m.processTypes[Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT],
    m.CRASH_TYPE_CRASH,
    "main-crash",
    DUMMY_DATE
  );
  await m.setRemoteCrashID("main-crash", "bp-1");
  Assert.equal((await m.getCrashes())[0].remoteID, "bp-1");
});

add_task(async function test_addCrashWrong() {
  let m = await getManager();

  let crashes = await m.getCrashes();
  Assert.equal(crashes.length, 0);

  await m.addCrash(
    m.processTypes[-1], // passing a wrong type to force 'undefined', it should
    m.CRASH_TYPE_CRASH, // fail in the end and not record it
    "wrong-content-crash",
    DUMMY_DATE
  );

  crashes = await m.getCrashes();
  Assert.equal(crashes.length, 0);
});

add_task(async function test_telemetryHistogram() {
  let Telemetry = Services.telemetry;
  let h = Telemetry.getKeyedHistogramById("PROCESS_CRASH_SUBMIT_ATTEMPT");
  h.clear();
  Telemetry.clearScalars();

  let m = await getManager();
  let processTypes = [];
  let crashTypes = [];

  // Gather all process types
  for (let field in m.processTypes) {
    if (m.isPingAllowed(m.processTypes[field])) {
      processTypes.push(m.processTypes[field]);
    }
  }

  // Gather all crash types
  for (let field in m) {
    if (field.startsWith("CRASH_TYPE_")) {
      crashTypes.push(m[field]);
    }
  }

  let keysCount = 0;
  let keys = [];

  for (let processType of processTypes) {
    for (let crashType of crashTypes) {
      let key = processType + "-" + crashType;

      keys.push(key);
      h.add(key, 1);
      keysCount++;
    }
  }

  // Ensure that we have generated some crash, otherwise it could indicate
  // something silently regressing
  Assert.greater(keysCount, 2);

  // Check that we have the expected keys.
  let snap = h.snapshot();
  Assert.equal(
    Object.keys(snap).length,
    keysCount,
    "Some crash types have not been recorded, see the list in Histograms.json"
  );
  Assert.deepEqual(
    Object.keys(snap).sort(),
    keys.sort(),
    "Some crash types do not match"
  );
});
