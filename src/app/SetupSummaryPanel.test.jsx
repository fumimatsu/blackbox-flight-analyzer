import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupSummaryPanel } from "./SetupSummaryPanel.jsx";
import { translate } from "../i18n/index.js";

const summary = {
  hasData: true,
  firmware: {
    display: "Betaflight 4.5.0",
  },
  groups: [
    {
      key: "pid",
      hasData: true,
      items: [
        { key: "rollPid", value: "52 / 58 / 38", rawValue: [52, 58, 38] },
        { key: "dMin", value: "42 / 45 / 0", rawValue: [42, 45, 0] },
      ],
    },
    {
      key: "drive",
      hasData: true,
      items: [{ key: "protocol", value: "DSHOT600", rawValue: "DSHOT600" }],
    },
  ],
};

describe("SetupSummaryPanel", () => {
  it("renders translated section labels in English", () => {
    const html = renderToStaticMarkup(
      <SetupSummaryPanel summary={summary} t={(key, params) => translate("en", key, params)} />
    );

    expect(html).toContain("Flight setup");
    expect(html).toContain("PID");
    expect(html).toContain("Motor drive");
    expect(html).toContain("Roll PID");
  });

  it("renders translated section labels in Japanese", () => {
    const html = renderToStaticMarkup(
      <SetupSummaryPanel summary={summary} t={(key, params) => translate("ja", key, params)} />
    );

    expect(html).toContain("機体設定");
    expect(html).toContain("PID");
    expect(html).toContain("駆動");
    expect(html).toContain("Roll PID");
  });
});
