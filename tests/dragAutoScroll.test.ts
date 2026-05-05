import { describe, expect, it } from "vitest";
import {
  calculateAutoScrollDelta,
  deriveNextAutoScrollFrame
} from "../src/sidepanel/components/dragAutoScroll";

describe("dragAutoScroll helpers", () => {
  it("calculateAutoScrollDelta returns the exact scaled step in the top hot zone", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 110,
        containerTop: 100,
        containerHeight: 300,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(-20);
  });

  it("calculateAutoScrollDelta returns the exact scaled step in the bottom hot zone", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 385,
        containerTop: 100,
        containerHeight: 300,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(18);
  });

  it("calculateAutoScrollDelta returns zero at the hot-zone boundary", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 160,
        containerTop: 100,
        containerHeight: 300,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(0);
  });

  it("calculateAutoScrollDelta returns zero in neutral zone", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 220,
        containerTop: 100,
        containerHeight: 300,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(0);
  });

  it("calculateAutoScrollDelta chooses the nearer bottom edge when hot zones overlap on the lower side", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 144,
        containerTop: 100,
        containerHeight: 80,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(10);
  });

  it("calculateAutoScrollDelta chooses the nearer top edge when hot zones overlap on the upper side", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 136,
        containerTop: 100,
        containerHeight: 80,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(-10);
  });

  it("calculateAutoScrollDelta chooses the top direction at the exact overlap midpoint tie", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 140,
        containerTop: 100,
        containerHeight: 80,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(-8);
  });

  it("calculateAutoScrollDelta applies maxStep at the exact container edges", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 100,
        containerTop: 100,
        containerHeight: 300,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(-24);

    expect(
      calculateAutoScrollDelta({
        pointerClientY: 400,
        containerTop: 100,
        containerHeight: 300,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(24);
  });

  it("calculateAutoScrollDelta returns zero just outside the container", () => {
    expect(
      calculateAutoScrollDelta({
        pointerClientY: 99,
        containerTop: 100,
        containerHeight: 300,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(0);

    expect(
      calculateAutoScrollDelta({
        pointerClientY: 401,
        containerTop: 100,
        containerHeight: 300,
        hotZoneSize: 60,
        maxStep: 24
      })
    ).toBe(0);
  });

  it("keeps recomputing the drop target while auto-scroll is active", () => {
    expect(
      deriveNextAutoScrollFrame({
        currentScrollTop: 40,
        maxScrollTop: 200,
        delta: 12
      })
    ).toEqual({
      nextScrollTop: 52,
      didScroll: true
    });

    expect(
      deriveNextAutoScrollFrame({
        currentScrollTop: 200,
        maxScrollTop: 200,
        delta: 12
      })
    ).toEqual({
      nextScrollTop: 200,
      didScroll: false
    });
  });

});
