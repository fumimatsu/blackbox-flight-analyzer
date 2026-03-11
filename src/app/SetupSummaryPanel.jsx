import React from "react";

function SetupSummaryCard({ group, t }) {
  if (!group?.hasData) {
    return null;
  }

  return (
    <article className="setup-summary__card">
      <header className="setup-summary__card-header">
        <h4>{t(`setup.groups.${group.key}`)}</h4>
        <span>{group.items.length}</span>
      </header>
      <dl className="setup-summary__list">
        {group.items.map((item) => (
          <div key={item.key} className="setup-summary__item">
            <dt>{t(`setup.fields.${item.key}`)}</dt>
            <dd title={String(item.rawValue ?? item.value)}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function SetupSummaryPanel({ summary, t }) {
  if (!summary?.hasData) {
    return null;
  }

  return (
    <section className="setup-summary">
      <div className="setup-summary__header">
        <div>
          <p className="setup-summary__eyebrow">{t("setup.eyebrow")}</p>
          <h3>{t("setup.title")}</h3>
        </div>
        {summary.firmware ? (
          <div className="setup-summary__firmware" title={summary.firmware.display}>
            <span>{t("setup.firmware")}</span>
            <strong>{summary.firmware.display}</strong>
          </div>
        ) : null}
      </div>
      <div className="setup-summary__grid">
        {summary.groups.map((group) => (
          <SetupSummaryCard key={group.key} group={group} t={t} />
        ))}
      </div>
    </section>
  );
}
