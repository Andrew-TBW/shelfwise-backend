// emailTemplates/weeklyReport.js
//
// Renders the Weekly Report as email-safe HTML: table-based layout,
// inline styles only — no external stylesheet, no CSS custom properties
// (email clients don't reliably support either, unlike a real browser).
// Same visual logic as the app's live tab — grouped by style, ordered
// worst-tier-first, same columns — just expressed in a way built to
// survive Gmail/Outlook/Apple Mail rendering rather than a browser.

const COLORS = {
  paper: "#E7E0CD",
  card: "#F4EFE1",
  ink: "#221D16",
  alertRed: "#B5432E",
  okGreen: "#3F6B4F",
  line: "#C9BFA0",
  monoGray: "#6B6355",
};

const TIER_META = {
  urgent: { label: "Reorder now", color: COLORS.alertRed },
  low: { label: "Getting low", color: "#8a6417" },
  incoming: { label: "On order", color: COLORS.monoGray },
  healthy: { label: "Well stocked", color: COLORS.okGreen },
  unknown: { label: "No sales logged", color: COLORS.monoGray },
};

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const th = (label) =>
  `<th style="text-align:left; font-size:10px; letter-spacing:0.03em; color:${COLORS.monoGray}; padding:4px 8px; border-bottom:1px solid ${COLORS.line};">${label}</th>`;

function renderGroup(group) {
  const headerRow = `
    <tr>
      <td colspan="6" style="padding:16px 8px 6px; font-family:Georgia, serif; font-weight:bold; font-size:14px; color:${COLORS.ink}; border-top:1px dashed ${COLORS.line};">
        ${escapeHtml(group.name)}
      </td>
    </tr>
    <tr>
      ${th("Variant")}${th("Inventory")}${th("Sold")}${th("Rate / day")}${th("Days left")}${th("Status")}
    </tr>`;

  const rows = group.variants
    .map((v) => {
      const meta = TIER_META[v.tier] || TIER_META.unknown;
      const td = (content, mono) =>
        `<td style="padding:6px 8px; border-bottom:1px dashed ${COLORS.line}; font-size:13px; color:${COLORS.ink};${mono ? " font-family:monospace;" : ""}">${content}</td>`;
      return `
      <tr>
        ${td(`${escapeHtml(v.label)}<br/><span style="font-size:10px; color:${COLORS.monoGray};">${escapeHtml(v.sku)}</span>`)}
        ${td(v.stock, true)}
        ${td(v.soldLastWeek, true)}
        ${td(v.rate > 0 ? v.rate.toFixed(2) : "—", true)}
        ${td(v.daysRemaining !== null ? Math.floor(v.daysRemaining) : "—", true)}
        <td style="padding:6px 8px; border-bottom:1px dashed ${COLORS.line}; font-size:12px; font-weight:bold; color:${meta.color};">${meta.label}</td>
      </tr>`;
    })
    .join("");

  return headerRow + rows;
}

function renderWeeklyReportEmail(storeName, report) {
  const { weekStartDisplay, weekEndDisplay, groups, totalVariants } = report;

  const bodyRows =
    totalVariants === 0
      ? `<tr><td colspan="6" style="padding:30px 8px; text-align:center; color:${COLORS.monoGray}; font-size:13px;">No styles on the shelf yet — nothing to report.</td></tr>`
      : groups.map(renderGroup).join("");

  return `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:${COLORS.paper}; font-family:Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.paper}; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:${COLORS.card}; border-radius:6px; overflow:hidden;">
          <tr>
            <td style="padding:24px 24px 8px;">
              <div style="font-family:Georgia, serif; font-weight:bold; font-size:20px; color:${COLORS.ink};">${escapeHtml(storeName)}</div>
              <div style="font-family:Georgia, serif; font-weight:bold; font-size:16px; color:${COLORS.ink}; margin-top:8px;">Weekly Report</div>
              <div style="font-size:12px; color:${COLORS.monoGray}; font-family:monospace;">${weekStartDisplay} – ${weekEndDisplay}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 16px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${bodyRows}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderWeeklyReportEmail };
