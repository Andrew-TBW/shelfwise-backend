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
  onOrderBlue: "#2E5C78", // same blue already used for "On order" everywhere else in the app
};

const TIER_META = {
  urgent: { label: "Reorder now", color: COLORS.alertRed },
  low: { label: "Getting low", color: "#8a6417" },
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

// The "REORDER SLIP" ticker, exactly as it appears pinned to the top of
// every screen in the app — reproduced here at the top of the email for
// the same reason: it's the one thing worth seeing before anything
// else, whether that's in the app or in an inbox.
function renderTickerBlock(report) {
  const { alerts, totalStyles, totalVariants, openPOCount } = report;
  const hasAlerts = alerts.length > 0;
  const todayDisplay = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  let bodyHtml;
  if (hasAlerts) {
    const shown = alerts.slice(0, 6);
    const rows = shown
      .map((a) => {
        const labelColor = a.tier === "urgent" ? COLORS.alertRed : "#e3c98a";
        const labelText = a.tier === "urgent" ? "REORDER NOW" : "WATCH";
        return `
        <tr>
          <td style="padding:3px 8px; font-size:11px; font-weight:bold; color:${labelColor}; white-space:nowrap; font-family:monospace;">${labelText}</td>
          <td style="padding:3px 8px; font-size:13px; color:${COLORS.card};">
            ${escapeHtml(a.styleName)} — ${escapeHtml(a.variantLabel)}
            <span style="opacity:0.6;">(${escapeHtml(a.vendorName)})</span>
          </td>
          <td style="padding:3px 8px; font-size:12px; color:${COLORS.card}; opacity:0.75; white-space:nowrap; font-family:monospace;">order ${a.recommendedOrder}</td>
        </tr>`;
      })
      .join("");
    const moreRow =
      alerts.length > 6
        ? `<tr><td colspan="3" style="padding:3px 8px; font-size:11px; color:${COLORS.card}; opacity:0.6;">+${alerts.length - 6} more in the app</td></tr>`
        : "";
    bodyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${moreRow}</table>`;
  } else {
    bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:3px 8px; font-size:13px;">
          <span style="color:${COLORS.okGreen}; font-weight:bold; font-family:monospace;">ALL CLEAR</span>
          <span style="color:${COLORS.card};"> — No variants need reordering right now</span>
        </td>
      </tr>
    </table>`;
  }

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.ink}; border-radius:6px; margin-bottom:20px;">
    <tr>
      <td style="padding:14px 16px 10px; border-bottom:1px dashed rgba(244,239,225,0.35);">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:Georgia, serif; font-weight:bold; font-size:15px; color:${COLORS.card}; letter-spacing:0.05em;">REORDER SLIP</td>
            <td align="right" style="font-family:monospace; font-size:12px; color:${COLORS.card}; opacity:0.7;">${todayDisplay}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 8px;">
        ${bodyHtml}
      </td>
    </tr>
    <tr>
      <td style="padding:10px 16px 14px; border-top:1px dashed rgba(244,239,225,0.35);">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px; color:${COLORS.card}; opacity:0.65; letter-spacing:0.03em; font-family:monospace;">
              ${totalStyles} style${totalStyles === 1 ? "" : "s"} · ${totalVariants} SKU${totalVariants === 1 ? "" : "s"}
            </td>
            <td align="right" style="font-size:11px; color:${COLORS.card}; opacity:0.65; letter-spacing:0.03em; font-family:monospace;">
              ${alerts.length} to reorder · ${openPOCount} PO${openPOCount === 1 ? "" : "s"} open
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
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
      // "(on order)" is always this one fixed blue, deliberately kept
      // separate from whatever color the status label itself is — it's
      // an annotation about a PO in transit, not part of the urgency
      // reading, so it shouldn't inherit red/amber/green.
      const onOrderNote = v.hasIncoming ? ` <span style="color:${COLORS.onOrderBlue};">(on order)</span>` : "";
      return `
      <tr>
        ${td(`${escapeHtml(v.label)}<br/><span style="font-size:10px; color:${COLORS.monoGray};">${escapeHtml(v.sku)}</span>`)}
        ${td(v.stock, true)}
        ${td(v.soldLastWeek, true)}
        ${td(v.rate > 0 ? v.rate.toFixed(2) : "—", true)}
        ${td(v.daysRemaining !== null ? Math.floor(v.daysRemaining) : "—", true)}
        <td style="padding:6px 8px; border-bottom:1px dashed ${COLORS.line}; font-size:12px;">
          <span style="font-weight:bold; color:${meta.color};">${meta.label}</span>${onOrderNote}
        </td>
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
            </td>
          </tr>
          <tr>
            <td style="padding:0 16px 8px;">
              ${renderTickerBlock(report)}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 8px;">
              <div style="font-family:Georgia, serif; font-weight:bold; font-size:16px; color:${COLORS.ink};">Weekly Report</div>
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
