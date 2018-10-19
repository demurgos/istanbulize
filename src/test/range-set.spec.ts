// import chai from "chai";
// import { RangeSet } from "../lib/range-set";
//
// describe("RangeSet", () => {
//   it("can create a range set from a single range", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//     ]);
//
//     const actual = rangeSet.getRanges();
//     const expected = [
//       {startOffset: 10, endOffset: 20, count: 3},
//     ];
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can create a range set from 2 ranges (equal)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 10, endOffset: 20, count: 1},
//     ]);
//
//     const actual = rangeSet.getRanges();
//     const expected = [
//       {startOffset: 10, endOffset: 20, count: 1},
//     ];
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can create a range set from 2 ranges (strict inclusion)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 12, endOffset: 18, count: 1},
//     ]);
//
//     const actual = rangeSet.getRanges();
//     const expected = [
//       {startOffset: 10, endOffset: 12, count: 3},
//       {startOffset: 12, endOffset: 18, count: 1},
//       {startOffset: 18, endOffset: 20, count: 3},
//     ];
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can create a range set from 2 ranges (same start, different end)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 10, endOffset: 18, count: 1},
//     ]);
//
//     const actual = rangeSet.getRanges();
//     const expected = [
//       {startOffset: 10, endOffset: 18, count: 1},
//       {startOffset: 18, endOffset: 20, count: 3},
//     ];
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can create a range set from 2 ranges (different start, same end)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 12, endOffset: 20, count: 1},
//     ]);
//
//     const actual = rangeSet.getRanges();
//     const expected = [
//       {startOffset: 10, endOffset: 12, count: 3},
//       {startOffset: 12, endOffset: 20, count: 1},
//     ];
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can create a range set from 3 ranges (the inner ranges don't touch each other)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 12, endOffset: 14, count: 1},
//       {startOffset: 16, endOffset: 18, count: 2},
//     ]);
//
//     const actual = rangeSet.getRanges();
//     const expected = [
//       {startOffset: 10, endOffset: 12, count: 3},
//       {startOffset: 12, endOffset: 14, count: 1},
//       {startOffset: 14, endOffset: 16, count: 3},
//       {startOffset: 16, endOffset: 18, count: 2},
//       {startOffset: 18, endOffset: 20, count: 3},
//     ];
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can create a range set from 3 ranges (the 3rd range is just after the 2nd)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 12, endOffset: 15, count: 1},
//       {startOffset: 15, endOffset: 18, count: 2},
//     ]);
//
//     const actual = rangeSet.getRanges();
//     const expected = [
//       {startOffset: 10, endOffset: 12, count: 3},
//       {startOffset: 12, endOffset: 15, count: 1},
//       {startOffset: 15, endOffset: 18, count: 2},
//       {startOffset: 18, endOffset: 20, count: 3},
//     ];
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can create a range set from 3 ranges (the 3rd range is just before the 2nd)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 15, endOffset: 18, count: 1},
//       {startOffset: 12, endOffset: 15, count: 2},
//     ]);
//
//     const actual = rangeSet.getRanges();
//     const expected = [
//       {startOffset: 10, endOffset: 12, count: 3},
//       {startOffset: 12, endOffset: 15, count: 2},
//       {startOffset: 15, endOffset: 18, count: 1},
//       {startOffset: 18, endOffset: 20, count: 3},
//     ];
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can query a count (complete range)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 12, endOffset: 15, count: 1},
//       {startOffset: 15, endOffset: 18, count: 2},
//     ]);
//
//     const actual = rangeSet.getCount(12, 15);
//     const expected = 1;
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can query a count (strict subset)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 12, endOffset: 15, count: 1},
//       {startOffset: 15, endOffset: 18, count: 2},
//     ]);
//
//     const actual = rangeSet.getCount(13, 14);
//     const expected = 1;
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can query a count (starts on split)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 12, endOffset: 15, count: 1},
//       {startOffset: 15, endOffset: 18, count: 2},
//     ]);
//
//     const actual = rangeSet.getCount(12, 14);
//     const expected = 1;
//     chai.assert.deepEqual(actual, expected);
//   });
//
//   it("can query a count (ends on a split)", () => {
//     const rangeSet = new RangeSet([
//       {startOffset: 10, endOffset: 20, count: 3},
//       {startOffset: 12, endOffset: 15, count: 1},
//       {startOffset: 15, endOffset: 18, count: 2},
//     ]);
//
//     const actual = rangeSet.getCount(13, 15);
//     const expected = 1;
//     chai.assert.deepEqual(actual, expected);
//   });
// });
