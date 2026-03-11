import React from "react";

function formatMaybe(value, digits = 0, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return `${Number(value).toFixed(digits).replace(/\.0+$/, "")}${suffix}`;
}

function formatPercentShare(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return `${Math.round(value * 100)}%`;
}

function AxisMetricCard({ axisKey, axisSummary, t }) {
  const axisLabel = t(`stickReview.${axisKey}`);

  return (
    <div className="compare-metric stick-review__metric">
      <span>{axisLabel}</span>
      <strong>
        {t("stickReview.rcSetpointGap")}{" "}
        {formatMaybe(axisSummary?.rcSetpointGapPeak, 0) ?? t("common.na")}
      </strong>
      <em>
        {t("stickReview.motionGap")}{" "}
        {formatMaybe(axisSummary?.rcSetpointDeltaGapMean, 1) ?? t("common.na")}
      </em>
      <p>
        {t("stickReview.rawCommandGap")}:{" "}
        {formatMaybe(axisSummary?.rawCommandGapPeak, 0) ?? t("stickReview.noRaw")}
      </p>
      <p>
        {t("stickReview.heldInput")}:{" "}
        {formatPercentShare(axisSummary?.heldInputShare) ?? t("common.na")}
      </p>
    </div>
  );
}

export function StickIntentPanel({ summary, focusLabel, focusMeta, t }) {
  return (
    <section className="setup-summary stick-review-panel">
      <div className="compare-panel__header">
        <h3>{t("stickReview.title")}</h3>
        <p>{t("stickReview.description")}</p>
        <div className="diagnostic-panel__scope">
          <div className="diagnostic-panel__scope-copy">
            <span>{t("stickReview.scope")}</span>
            <strong>{focusLabel}</strong>
            {focusMeta ? <em>{focusMeta}</em> : null}
          </div>
        </div>
      </div>
      {summary?.hasAnyData ? (
        <div className="stick-review__grid">
          <div className="compare-metric compare-metric--context stick-review__overview">
            <span>{t("stickReview.primaryAxis")}</span>
            <strong>
              {summary.primaryAxis ? t(`stickReview.${summary.primaryAxis.axis}`) : t("common.na")}
            </strong>
            <div className="stick-review__overview-stats">
              <p>
                {t("stickReview.activeSamples")}:{" "}
                {summary.primaryAxis?.activeSamples ?? 0}
              </p>
              <p>
                {t("stickReview.rcSetpointGap")}:{" "}
                {formatMaybe(summary.primaryAxis?.rcSetpointGapPeak, 0) ?? t("common.na")}
              </p>
              <p>
                {t("stickReview.rawCommandGap")}:{" "}
                {formatMaybe(summary.primaryAxis?.rawCommandGapPeak, 0) ?? t("stickReview.noRaw")}
              </p>
              <p>
                {t("stickReview.motionGap")}:{" "}
                {formatMaybe(summary.primaryAxis?.rcSetpointDeltaGapMean, 1) ?? t("common.na")}
              </p>
            </div>
          </div>

          <div className="stick-review__axis-grid">
            {["roll", "pitch", "yaw"].map((axisKey) => (
              <AxisMetricCard
                key={axisKey}
                axisKey={axisKey}
                axisSummary={summary.axes?.[axisKey]}
                t={t}
              />
            ))}
          </div>

          <div className="compare-metric compare-metric--notes stick-review__notes">
            <span>{t("stickReview.configTitle")}</span>
            {summary.configuration.feedforward ? <p>FF: {summary.configuration.feedforward}</p> : null}
            {summary.configuration.rcSmoothing ? <p>{summary.configuration.rcSmoothing}</p> : null}
            {summary.configuration.rcSmoothingCutoffs ? (
              <p>{summary.configuration.rcSmoothingCutoffs}</p>
            ) : null}
            {summary.configuration.ratesType ? <p>{summary.configuration.ratesType}</p> : null}
          </div>

          <div className="compare-metric compare-metric--notes stick-review__notes">
            <span>{t("stickReview.debugTitle")}</span>
            {summary.debug?.mode ? (
              <>
                <p>
                  {t("stickReview.debugMode")}: {summary.debug.mode}
                </p>
                {summary.debug.items.length ? (
                  summary.debug.items.map((item) => (
                    <p key={item.key}>
                      {t(`stickReview.debug.${item.key}`)}: {item.display}
                    </p>
                  ))
                ) : (
                  <p>{summary.debug.mode}</p>
                )}
              </>
            ) : (
              <p>{t("stickReview.noDebug")}</p>
            )}
          </div>

          <div className="compare-metric compare-metric--notes stick-review__notes">
            <span>{t("stickReview.radioTitle")}</span>
            <p>
              {t("stickReview.rssi")}: {formatMaybe(summary.radio?.rssiAvg, 0) ?? t("common.na")}
            </p>
            <p>
              {t("stickReview.linkQuality")}:{" "}
              {formatMaybe(summary.debug?.linkQualityAvg, 0, "%") ?? t("common.na")}
            </p>
          </div>
        </div>
      ) : (
        <p className="muted">{t("stickReview.empty")}</p>
      )}
    </section>
  );
}
