// |reftest| skip -- Temporal is not supported
// Copyright (C) 2022 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-get-temporal.plainyearmonth.prototype.year
description: Validate result returned from calendar year() method
features: [Temporal]
---*/

const badResults = [
  [undefined, RangeError],
  [Infinity, RangeError],
  [-Infinity, RangeError],
  [Symbol("foo"), TypeError],
  [7n, TypeError],
  [NaN, RangeError],
  ["string", RangeError],
  [{}, RangeError],
];

badResults.forEach(([result, error]) => {
  const calendar = new class extends Temporal.Calendar {
    year() {
      return result;
    }
  }("iso8601");
  const instance = new Temporal.PlainYearMonth(1981, 12, calendar);
  assert.throws(error, () => instance.year, `${typeof result} not converted to integer`);
});

const convertedResults = [
  [null, 0],
  [true, 1],
  [false, 0],
  [7.1, 7],
  [-7, -7],
  [-0.1, 0],
  ["7", 7],
  ["7.5", 7],
  [{valueOf() { return 7; }}, 7],
];

convertedResults.forEach(([result, convertedResult]) => {
  const calendar = new class extends Temporal.Calendar {
    year() {
      return result;
    }
  }("iso8601");
  const instance = new Temporal.PlainYearMonth(1981, 12, calendar);
  assert.sameValue(instance.year, convertedResult, `${typeof result} converted to integer ${convertedResult}`);
});

reportCompare(0, 0);
