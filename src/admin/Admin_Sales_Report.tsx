// src/pages/Admin_Sales_Report.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonCard,
  IonCardContent,
  IonSpinner,
  IonText,
  IonItem,
  IonLabel,
  IonInput,
  IonGrid,
  IonRow,
  IonCol,
  IonButton,
  IonToast,
  IonModal,
  IonButtons,
  IonIcon,
  IonDatetime,
  IonAlert,
} from "@ionic/react";
import { calendarOutline, closeOutline, downloadOutline, trashOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

/* =========================
   TYPES
========================= */

type MoneyKind = "cash" | "coin";

interface DailyReportRow {
  id: string;
  report_date: string; // YYYY-MM-DD
  starting_cash: number | string;
  starting_gcash: number | string;
  bilin_amount: number | string;

  is_submitted?: boolean;
  submitted_at?: string | null;
}

interface CashCountDBRow {
  report_id: string;
  money_kind: MoneyKind;
  denomination: number | string;
  qty: number;
}

interface CashLine {
  report_id: string;
  money_kind: MoneyKind;
  denomination: number;
  qty: number;
}

interface SalesTotalsRow {
  id: string;
  report_date: string;

  starting_cash: number | string;
  starting_gcash: number | string;
  bilin_amount: number | string;

  coh_total: number | string;
  expenses_amount: number | string;

  paid_reservation_cash: number | string;
  paid_reservation_gcash: number | string;

  advance_cash: number | string;
  advance_gcash: number | string;

  walkin_cash: number | string;
  walkin_gcash: number | string;

  total_time: number | string;

  addons_total: number | string;
  discount_total: number | string;

  cash_sales: number | string;
  gcash_sales: number | string;

  system_sale: number | string;

  sales_collected: number | string;
  net_collected: number | string;
}

type ConsignmentState = {
  gross: number; // total sales for CONSIGNMENT category
  fee15: number; // 15% fee
  net: number; // gross - fee15
};

/* =========================
   CONSTANTS
========================= */

const CASH_DENOMS: number[] = [1000, 500, 200, 100, 50];
const COIN_DENOMS: number[] = [20, 10, 5, 1];

const toNumber = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const todayYMD = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const isYMD = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

const peso = (n: number): string =>
  `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* =========================
   SAFE EVENT VALUE HELPERS (NO any)
========================= */

const getDetailValue = (ev: unknown): unknown => {
  if (!ev || typeof ev !== "object") return null;
  if (!("detail" in ev)) return null;

  const detail = (ev as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object") return null;

  return (detail as { value?: unknown }).value ?? null;
};

const valueToString = (v: unknown): string => {
  if (typeof v === "string") return v;
  return "";
};

const valueToNonNegInt = (v: unknown): number => {
  const s = valueToString(v).trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
};

const valueToNonNegMoney = (v: unknown): number => {
  const s = valueToString(v).trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
};

/* =========================
   DATE HELPERS
========================= */

const isoToYMD = (iso: string): string => {
  const raw = iso.trim();
  if (!raw) return todayYMD();
  const ymd = raw.slice(0, 10);
  return isYMD(ymd) ? ymd : todayYMD();
};

const buildZeroLines = (reportId: string): CashLine[] => {
  const merged: CashLine[] = [];
  for (const d of CASH_DENOMS) merged.push({ report_id: reportId, money_kind: "cash", denomination: d, qty: 0 });
  for (const d of COIN_DENOMS) merged.push({ report_id: reportId, money_kind: "coin", denomination: d, qty: 0 });
  return merged;
};

/* =========================
   PAGE
========================= */

const AdminSalesReport: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(() => todayYMD());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [loading, setLoading] = useState<boolean>(true);

  const [report, setReport] = useState<DailyReportRow | null>(null);
  const [lines, setLines] = useState<CashLine[]>([]);
  const [totals, setTotals] = useState<SalesTotalsRow | null>(null);

  // ✅ CONSIGNMENT SUMMARY
  const [consignment, setConsignment] = useState<ConsignmentState>({ gross: 0, fee15: 0, net: 0 });

  // ✅ ADD-ONS (PAID ONLY) for "Other Totals" + PDF
  const [addonsPaid, setAddonsPaid] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; msg: string; color?: string }>({
    open: false,
    msg: "",
    color: "success",
  });

  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);

  /* =========================
     LOAD / ENSURE REPORT
  ========================= */

  const ensureReportRow = async (dateYMD: string): Promise<void> => {
    const upsertRes = await supabase
      .from("daily_sales_reports")
      .upsert(
        { report_date: dateYMD, starting_cash: 0, starting_gcash: 0, bilin_amount: 0 },
        { onConflict: "report_date", ignoreDuplicates: true }
      );

    if (upsertRes.error) {
      console.error("daily_sales_reports ensure(upsert) error:", upsertRes.error.message);
    }
  };

  const loadReport = async (dateYMD: string): Promise<void> => {
    setLoading(true);

    if (!isYMD(dateYMD)) {
      setReport(null);
      setLines([]);
      setTotals(null);
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      setAddonsPaid(0);
      setLoading(false);
      return;
    }

    await ensureReportRow(dateYMD);

    const res = await supabase
      .from("daily_sales_reports")
      .select("id, report_date, starting_cash, starting_gcash, bilin_amount, is_submitted, submitted_at")
      .eq("report_date", dateYMD)
      .single<DailyReportRow>();

    if (res.error) {
      console.error("daily_sales_reports select error:", res.error.message);
      setReport(null);
      setLines([]);
      setTotals(null);
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      setAddonsPaid(0);
      setLoading(false);
      return;
    }

    setReport(res.data);
    setLoading(false);
  };

  const loadCashLines = async (reportId: string): Promise<void> => {
    const res = await supabase
      .from("daily_cash_count_lines")
      .select("report_id, money_kind, denomination, qty")
      .eq("report_id", reportId);

    if (res.error) {
      console.error("daily_cash_count_lines select error:", res.error.message);
      setLines(buildZeroLines(reportId));
      return;
    }

    const rows: CashCountDBRow[] = (res.data ?? []) as CashCountDBRow[];
    const merged: CashLine[] = [];

    for (const d of CASH_DENOMS) {
      const found = rows.find((r) => r.money_kind === "cash" && toNumber(r.denomination) === d);
      merged.push({ report_id: reportId, money_kind: "cash", denomination: d, qty: found?.qty ?? 0 });
    }

    for (const d of COIN_DENOMS) {
      const found = rows.find((r) => r.money_kind === "coin" && toNumber(r.denomination) === d);
      merged.push({ report_id: reportId, money_kind: "coin", denomination: d, qty: found?.qty ?? 0 });
    }

    setLines(merged);
  };

  const loadTotals = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setTotals(null);
      return;
    }

    const res = await supabase
      .from("v_daily_sales_report_totals")
      .select("*")
      .eq("report_date", dateYMD)
      .single<SalesTotalsRow>();

    if (res.error) {
      console.error("v_daily_sales_report_totals error:", res.error.message);
      setTotals(null);
      return;
    }

    setTotals(res.data);
  };

  /**
   * ✅ CONSIGNMENT: PAID ONLY
   * IMPORTANT: use paid_at date (NOT created_at),
   * so unpaid rows never count, and paid rows count on the day they were paid.
   */
  const loadConsignment = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      return;
    }

    const startISO = `${dateYMD}T00:00:00.000`;
    const endISO = `${dateYMD}T23:59:59.999`;

    const res = await supabase
      .from("customer_session_add_ons")
      .select("total, paid_at, add_ons!inner(category)")
      .eq("is_paid", true)
      .not("paid_at", "is", null)
      .eq("add_ons.category", "CONSIGNMENT")
      .gte("paid_at", startISO)
      .lte("paid_at", endISO);

    if (res.error) {
      console.error("consignment query error:", res.error.message);
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      return;
    }

    const rows = (res.data ?? []) as Array<{ total: number | string | null }>;
    const gross = rows.reduce((sum, r) => sum + toNumber(r.total), 0);
    const fee15 = gross * 0.15;
    const net = gross - fee15;

    setConsignment({ gross, fee15, net });
  };

  /**
   * ✅ ADD-ONS: PAID ONLY (for "Other Totals" and PDF)
   * uses paid_at date so it records on the day paid.
   */
  const loadAddonsPaid = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setAddonsPaid(0);
      return;
    }

    const startISO = `${dateYMD}T00:00:00.000`;
    const endISO = `${dateYMD}T23:59:59.999`;

    const res = await supabase
      .from("customer_session_add_ons")
      .select("total, paid_at")
      .eq("is_paid", true)
      .not("paid_at", "is", null)
      .gte("paid_at", startISO)
      .lte("paid_at", endISO);

    if (res.error) {
      console.error("addonsPaid query error:", res.error.message);
      setAddonsPaid(0);
      return;
    }

    const rows = (res.data ?? []) as Array<{ total: number | string | null }>;
    const gross = rows.reduce((sum, r) => sum + toNumber(r.total), 0);
    setAddonsPaid(gross);
  };

  const upsertQty = async (line: CashLine, qty: number): Promise<void> => {
    if (!report || submitting) return;

    const res = await supabase
      .from("daily_cash_count_lines")
      .upsert(
        { report_id: line.report_id, money_kind: line.money_kind, denomination: line.denomination, qty },
        { onConflict: "report_id,money_kind,denomination" }
      );

    if (res.error) {
      console.error("daily_cash_count_lines upsert error:", res.error.message);
      return;
    }

    setLines((prev) =>
      prev.map((x) =>
        x.money_kind === line.money_kind && x.denomination === line.denomination ? { ...x, qty } : x
      )
    );

    await loadTotals(selectedDate);
  };

  const updateReportField = async (
    field: "starting_cash" | "starting_gcash" | "bilin_amount",
    valueNum: number
  ): Promise<void> => {
    if (!report || submitting) return;

    const safe = Math.max(0, valueNum);
    const res = await supabase.from("daily_sales_reports").update({ [field]: safe }).eq("id", report.id);

    if (res.error) {
      console.error("daily_sales_reports update error:", res.error.message);
      return;
    }

    setReport((prev) => (prev ? { ...prev, [field]: safe } : prev));
    await loadTotals(selectedDate);
  };

  /* =========================
     ADMIN: SAVE / UPDATE
  ========================= */

  const onSubmitDone = async (): Promise<void> => {
    if (!report) return;

    if (!isYMD(selectedDate)) {
      setToast({ open: true, msg: "Invalid date. Use YYYY-MM-DD.", color: "danger" });
      return;
    }

    setSubmitting(true);

    const r1 = await supabase
      .from("daily_sales_reports")
      .update({
        starting_cash: Math.max(0, toNumber(report.starting_cash)),
        starting_gcash: Math.max(0, toNumber(report.starting_gcash)),
        bilin_amount: Math.max(0, toNumber(report.bilin_amount)),
      })
      .eq("id", report.id);

    if (r1.error) {
      setToast({ open: true, msg: `Save failed: ${r1.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    const payload = lines.map((l) => ({
      report_id: l.report_id,
      money_kind: l.money_kind,
      denomination: l.denomination,
      qty: Math.max(0, Math.floor(toNumber(l.qty))),
    }));

    if (payload.length > 0) {
      const r2 = await supabase
        .from("daily_cash_count_lines")
        .upsert(payload, { onConflict: "report_id,money_kind,denomination" });

      if (r2.error) {
        setToast({ open: true, msg: `Save lines failed: ${r2.error.message}`, color: "danger" });
        setSubmitting(false);
        return;
      }
    }

    const res = await supabase
      .from("daily_sales_reports")
      .update({ is_submitted: true, submitted_at: new Date().toISOString() })
      .eq("id", report.id);

    if (res.error) {
      setToast({ open: true, msg: `Submit failed: ${res.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    await loadReport(selectedDate);
    await loadTotals(selectedDate);
    await loadConsignment(selectedDate);
    await loadAddonsPaid(selectedDate); // ✅ keep paid add-ons fresh

    setToast({ open: true, msg: `Saved for ${selectedDate}.`, color: "success" });
    setSubmitting(false);
  };

  /* =========================
     ADMIN: DELETE BY DATE
  ========================= */

  const deleteByDate = async (): Promise<void> => {
    if (!isYMD(selectedDate)) {
      setToast({ open: true, msg: "Invalid date.", color: "danger" });
      return;
    }

    setSubmitting(true);

    const find = await supabase
      .from("daily_sales_reports")
      .select("id")
      .eq("report_date", selectedDate)
      .maybeSingle<{ id: string }>();

    if (find.error) {
      setToast({ open: true, msg: `Delete failed: ${find.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    const reportId = find.data?.id;
    if (!reportId) {
      setToast({ open: true, msg: "No report found for that date.", color: "warning" });
      setSubmitting(false);
      return;
    }

    const d1 = await supabase.from("daily_cash_count_lines").delete().eq("report_id", reportId);
    if (d1.error) {
      setToast({ open: true, msg: `Delete lines failed: ${d1.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    const d2 = await supabase.from("daily_sales_reports").delete().eq("id", reportId);
    if (d2.error) {
      setToast({ open: true, msg: `Delete report failed: ${d2.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    setToast({ open: true, msg: `Deleted report for ${selectedDate}.`, color: "success" });

    await loadReport(selectedDate);
    await loadConsignment(selectedDate);
    await loadAddonsPaid(selectedDate);
    setSubmitting(false);
  };

  /* =========================
     EXPORT TO PDF (Print)
  ========================= */

  const exportToPDF = (): void => {
    if (!report || !isYMD(selectedDate)) {
      setToast({ open: true, msg: "Pick a valid date first.", color: "danger" });
      return;
    }

    const cashLines = lines.filter((x) => x.money_kind === "cash");
    const coinLines = lines.filter((x) => x.money_kind === "coin");

    const cashTotalLocal = cashLines.reduce((sum, l) => sum + l.denomination * l.qty, 0);
    const coinTotalLocal = coinLines.reduce((sum, l) => sum + l.denomination * l.qty, 0);

    const coh = totals ? toNumber(totals.coh_total) : 0;
    const salesCollected = totals ? toNumber(totals.sales_collected) : coh;
    const bilin = toNumber(report.bilin_amount);
    const netCollected = totals ? toNumber(totals.net_collected) : salesCollected - bilin;

    const expenses = totals ? toNumber(totals.expenses_amount) : 0;
    const cashSales = totals ? toNumber(totals.cash_sales) : 0;
    const gcashSales = totals ? toNumber(totals.gcash_sales) : 0;

    // ✅ PAID ONLY add-ons for PDF too
    const addons = addonsPaid;

    const discount = totals ? toNumber(totals.discount_total) : 0;
    const systemSale = totals ? toNumber(totals.system_sale) : 0;

    const totalTimeAmount =
      (totals ? toNumber(totals.walkin_cash) : 0) + (totals ? toNumber(totals.walkin_gcash) : 0);

    const paidResCash = totals ? toNumber(totals.paid_reservation_cash) : 0;
    const paidResGcash = totals ? toNumber(totals.paid_reservation_gcash) : 0;

    const advCash = totals ? toNumber(totals.advance_cash) : 0;
    const advGcash = totals ? toNumber(totals.advance_gcash) : 0;

    const walkCash = totals ? toNumber(totals.walkin_cash) : 0;
    const walkGcash = totals ? toNumber(totals.walkin_gcash) : 0;

    const consGross = consignment.gross;
    const consFee = consignment.fee15;
    const consNet = consignment.net;

    const maxLen = Math.max(cashLines.length, coinLines.length);
    const rowsHtml = Array.from({ length: maxLen })
      .map((_, i) => {
        const c = cashLines[i];
        const k = coinLines[i];

        const cashDen = c ? c.denomination : "";
        const cashQty = c ? c.qty : "";
        const cashAmt = c ? peso(c.denomination * c.qty) : "";

        const coinDen = k ? k.denomination : "";
        const coinQty = k ? k.qty : "";
        const coinAmt = k ? peso(k.denomination * k.qty) : "";

        return `
        <tr>
          <td class="t-center">${cashDen}</td>
          <td class="t-center">${cashQty}</td>
          <td class="t-right">${cashAmt}</td>
          <td class="gap"></td>
          <td class="t-center">${coinDen}</td>
          <td class="t-center">${coinQty}</td>
          <td class="t-right">${coinAmt}</td>
        </tr>
      `;
      })
      .join("");

    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Daily Sales Report ${selectedDate}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, sans-serif; color:#111; }
  .title { font-size:18px; font-weight:800; margin:0 0 8px; }
  .meta { font-size:12px; margin:0 0 10px; }
  .grid { display:flex; gap:14px; }
  .box { border:1px solid #222; border-radius:10px; padding:10px; flex:1; }
  .box h3 { margin:0 0 8px; font-size:12px; letter-spacing:.5px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { border:1px solid #222; padding:6px 8px; }
  th { background:#f2d0a7; }
  .t-right { text-align:right; }
  .t-center { text-align:center; }
  .gap { border:none; width:10px; }
  .summary { display:flex; gap:14px; margin-top:10px; }
  .chip { border:1px solid #222; border-radius:10px; padding:10px; flex:1; }
  .row { display:flex; justify-content:space-between; padding:4px 0; font-size:12px; }
  .row b { font-weight:800; }
</style>
</head>
<body>
  <div class="title">DAILY SALES REPORT (Metyme)</div>
  <div class="meta">
    <div><b>Report Date:</b> ${selectedDate}</div>
    <div><b>Status:</b> ${report.is_submitted ? "SUBMITTED" : "DRAFT"}</div>
    <div><b>Submitted At:</b> ${report.submitted_at ? new Date(report.submitted_at).toLocaleString() : "-"}</div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>CATEGORY</h3>
      <table>
        <thead>
          <tr><th>CATEGORY</th><th>CASH</th><th>GCASH</th></tr>
        </thead>
        <tbody>
          <tr><td>Starting Balance</td><td class="t-right">${peso(toNumber(report.starting_cash))}</td><td class="t-right">${peso(toNumber(report.starting_gcash))}</td></tr>
          <tr><td>COH / Total of the Day</td><td class="t-right">${peso(cashTotalLocal + coinTotalLocal)}</td><td class="t-right">—</td></tr>
          <tr><td>Expenses</td><td class="t-right">${peso(expenses)}</td><td class="t-right">—</td></tr>
          <tr><td>Paid reservations for today</td><td class="t-right">${peso(paidResCash)}</td><td class="t-right">${peso(paidResGcash)}</td></tr>
          <tr><td>New Advance Payments</td><td class="t-right">${peso(advCash)}</td><td class="t-right">${peso(advGcash)}</td></tr>
          <tr><td>Down payments within this day only</td><td class="t-right">${peso(walkCash)}</td><td class="t-right">${peso(walkGcash)}</td></tr>
          <tr><td><b>Sales System</b></td><td class="t-right" colspan="2"><b>${peso(systemSale)}</b></td></tr>
        </tbody>
      </table>
    </div>

    <div class="box">
      <h3>CASH COUNT</h3>
      <table>
        <thead>
          <tr>
            <th colspan="3">CASH</th>
            <th class="gap"></th>
            <th colspan="3">COINS</th>
          </tr>
          <tr>
            <th>DENOM</th><th>QTY</th><th>AMOUNT</th>
            <th class="gap"></th>
            <th>DENOM</th><th>QTY</th><th>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr>
            <td colspan="2"><b>TOTAL CASH</b></td><td class="t-right"><b>${peso(cashTotalLocal)}</b></td>
            <td class="gap"></td>
            <td colspan="2"><b>TOTAL COINS</b></td><td class="t-right"><b>${peso(coinTotalLocal)}</b></td>
          </tr>
        </tbody>
      </table>

      <div class="summary">
        <div class="chip">
          <div class="row"><span>Cash Sales</span><b>${peso(cashSales)}</b></div>
          <div class="row"><span>GCash Sales</span><b>${peso(gcashSales)}</b></div>
          <div class="row"><span>Sales Collected</span><b>${peso(salesCollected)}</b></div>
          <div class="row"><span>Bilin</span><b>${peso(Math.max(0, bilin))}</b></div>
          <div class="row"><span>Net</span><b>${peso(netCollected)}</b></div>
        </div>

        <div class="chip">
          <div class="row"><span>Total Time</span><b>${peso(totalTimeAmount)}</b></div>
          <div class="row"><span>Add-ons (Paid)</span><b>${peso(addons)}</b></div>
          <div class="row"><span>Discounts</span><b>${peso(discount)}</b></div>
          <div class="row"><span>Consignment Sales</span><b>${peso(consGross)}</b></div>
          <div class="row"><span>Consignment 15%</span><b>${peso(consFee)}</b></div>
          <div class="row"><span>Consignment Net</span><b>${peso(consNet)}</b></div>
        </div>
      </div>
    </div>
  </div>

<script>
  window.onload = () => { window.print(); };
</script>
</body>
</html>
`;

    const w = window.open("", "_blank");
    if (!w) {
      setToast({ open: true, msg: "Popup blocked. Allow popups then try again.", color: "danger" });
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();

    setToast({ open: true, msg: "Opened print view. Save as PDF.", color: "success" });
  };

  /* =========================
     LOAD when date changes
  ========================= */

  useEffect(() => {
    void loadReport(selectedDate);
    void loadConsignment(selectedDate);
    void loadAddonsPaid(selectedDate); // ✅ PAID ONLY add-ons
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (!report) return;
    void loadCashLines(report.id);
    void loadTotals(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  /* =========================
     COMPUTED (UI)
  ========================= */

  const cashTotal = useMemo(() => {
    return lines
      .filter((l) => l.money_kind === "cash")
      .reduce((sum, l) => sum + l.denomination * l.qty, 0);
  }, [lines]);

  const coinTotal = useMemo(() => {
    return lines
      .filter((l) => l.money_kind === "coin")
      .reduce((sum, l) => sum + l.denomination * l.qty, 0);
  }, [lines]);

  const coh = totals ? toNumber(totals.coh_total) : 0;
  const salesCollected = totals ? toNumber(totals.sales_collected) : coh;
  const bilin = report ? toNumber(report.bilin_amount) : 0;
  const netCollected = totals ? toNumber(totals.net_collected) : salesCollected - bilin;

  const expenses = totals ? toNumber(totals.expenses_amount) : 0;
  const cashSales = totals ? toNumber(totals.cash_sales) : 0;
  const gcashSales = totals ? toNumber(totals.gcash_sales) : 0;

  // ✅ IMPORTANT: Other Totals Add-ons uses PAID ONLY
  const addons = addonsPaid;

  const discount = totals ? toNumber(totals.discount_total) : 0;
  const systemSale = totals ? toNumber(totals.system_sale) : 0;

  const totalTimeAmount =
    (totals ? toNumber(totals.walkin_cash) : 0) + (totals ? toNumber(totals.walkin_gcash) : 0);

  if (loading) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <div className="ssr-loading">
            <IonSpinner />
            <IonText className="ssr-loading-text">Loading…</IonText>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const submitLabel = report?.is_submitted ? "SAVE / UPDATE" : "SAVE / SUBMIT";

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Daily Sales Report (Admin)</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding ssr-page">
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2400}
          onDidDismiss={() => setToast((p) => ({ ...p, open: false }))}
        />

        <IonAlert
          isOpen={deleteAlertOpen}
          onDidDismiss={() => setDeleteAlertOpen(false)}
          header="Delete by Date"
          message={`Delete sales report for ${selectedDate}? This will remove the report + cash lines for that date only.`}
          buttons={[
            { text: "Cancel", role: "cancel" },
            { text: "Delete", role: "destructive", handler: () => void deleteByDate() },
          ]}
        />

        {/* DATE + BUTTONS */}
        <IonCard className="ssr-card">
          <IonCardContent className="ssr-card-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <IonItem lines="none" className="ssr-date-item">
                  <IonLabel position="stacked">Report Date (YYYY-MM-DD)</IonLabel>

                  <div className="ssr-date-inline">
                    <IonInput
                      className="ssr-date-input"
                      value={selectedDate}
                      placeholder="YYYY-MM-DD"
                      inputmode="numeric"
                      disabled={submitting}
                      onIonChange={(ev) => {
                        const v = valueToString(getDetailValue(ev)).trim();
                        if (isYMD(v)) setSelectedDate(v);
                        else if (v === "") setSelectedDate("");
                      }}
                      onIonBlur={() => {
                        if (!selectedDate) setSelectedDate(todayYMD());
                      }}
                    />

                    <IonButton className="ssr-cal-btn" fill="clear" disabled={submitting} onClick={() => setDatePickerOpen(true)}>
                      <IonIcon icon={calendarOutline} />
                    </IonButton>
                  </div>
                </IonItem>

                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                  Status: <b>{report?.is_submitted ? "SUBMITTED" : "DRAFT"}</b>
                  {report?.submitted_at ? (
                    <span style={{ marginLeft: 8 }}>(last submit: {new Date(report.submitted_at).toLocaleString()})</span>
                  ) : null}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <IonButton color="medium" fill="outline" disabled={submitting || !report} onClick={() => exportToPDF()}>
                  <IonIcon slot="start" icon={downloadOutline} />
                  Export PDF
                </IonButton>

                <IonButton
                  color="danger"
                  fill="outline"
                  disabled={submitting || !isYMD(selectedDate)}
                  onClick={() => setDeleteAlertOpen(true)}
                >
                  <IonIcon slot="start" icon={trashOutline} />
                  Delete by Date
                </IonButton>

                <IonButton strong disabled={submitting || !report} onClick={() => void onSubmitDone()}>
                  {submitting ? "Saving..." : submitLabel}
                </IonButton>
              </div>
            </div>
          </IonCardContent>
        </IonCard>

        {/* Calendar Modal */}
        <IonModal isOpen={datePickerOpen} onDidDismiss={() => setDatePickerOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Select Date</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setDatePickerOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            <IonDatetime
              presentation="date"
              value={selectedDate || todayYMD()}
              onIonChange={(ev) => {
                const v = valueToString(getDetailValue(ev));
                const ymd = isoToYMD(v);
                setSelectedDate(ymd);
                setDatePickerOpen(false);
              }}
            />
          </IonContent>
        </IonModal>

        <IonGrid className="ssr-grid">
          <IonRow>
            {/* LEFT */}
            <IonCol size="12" sizeMd="6">
              <IonCard className="ssr-card">
                <IonCardContent className="ssr-card-body">
                  <div className="ssr-left-head">
                    <div className="ssr-left-title">CATEGORY</div>
                    <div className="ssr-left-cols">
                      <span className="ssr-left-col">CASH</span>
                      <span className="ssr-left-col">GCASH</span>
                    </div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Starting Balance</div>

                    <div className="ssr-left-cell">
                      <IonItem lines="none" className="ssr-input-item">
                        <IonLabel position="stacked">Cash</IonLabel>
                        <IonInput
                          className="ssr-input"
                          type="number"
                          inputmode="decimal"
                          disabled={submitting}
                          value={report ? String(toNumber(report.starting_cash)) : "0"}
                          onIonChange={(ev) => updateReportField("starting_cash", valueToNonNegMoney(getDetailValue(ev)))}
                        />
                      </IonItem>
                    </div>

                    <div className="ssr-left-cell">
                      <IonItem lines="none" className="ssr-input-item">
                        <IonLabel position="stacked">GCash</IonLabel>
                        <IonInput
                          className="ssr-input"
                          type="number"
                          inputmode="decimal"
                          disabled={submitting}
                          value={report ? String(toNumber(report.starting_gcash)) : "0"}
                          onIonChange={(ev) => updateReportField("starting_gcash", valueToNonNegMoney(getDetailValue(ev)))}
                        />
                      </IonItem>
                    </div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">COH / Total of the Day</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(cashTotal + coinTotal)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">—</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Expenses</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(expenses)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">—</div>
                  </div>

                  <div className="ssr-left-row ssr-left-row--tint">
                    <div className="ssr-left-label">Paid reservations for today</div>
                    <div className="ssr-left-value ssr-left-value--cash">
                      {peso(totals ? toNumber(totals.paid_reservation_cash) : 0)}
                    </div>
                    <div className="ssr-left-value ssr-left-value--gcash">
                      {peso(totals ? toNumber(totals.paid_reservation_gcash) : 0)}
                    </div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">New Advance Payments</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(totals ? toNumber(totals.advance_cash) : 0)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(totals ? toNumber(totals.advance_gcash) : 0)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Down payments within this day only</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(totals ? toNumber(totals.walkin_cash) : 0)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(totals ? toNumber(totals.walkin_gcash) : 0)}</div>
                  </div>

                  <div className="ssr-left-row ssr-left-row--system">
                    <div className="ssr-left-label">Sales System</div>
                    <div className="ssr-left-value ssr-left-value--system ssr-span-2">{peso(systemSale)}</div>
                  </div>

                  <div className="ssr-sales-boxes">
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Cash Sales</span>
                      <span className="ssr-sales-box-value">{peso(cashSales)}</span>
                    </div>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">GCash Sales</span>
                      <span className="ssr-sales-box-value">{peso(gcashSales)}</span>
                    </div>
                  </div>

                  {/* CONSIGNMENT */}
                  <div className="ssr-sales-boxes" style={{ marginTop: 10 }}>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Consignment Sales</span>
                      <span className="ssr-sales-box-value">{peso(consignment.gross)}</span>
                    </div>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Consignment 15%</span>
                      <span className="ssr-sales-box-value">{peso(consignment.fee15)}</span>
                    </div>
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Consignment Net</span>
                      <span className="ssr-sales-box-value">{peso(consignment.net)}</span>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>
            </IonCol>

            {/* RIGHT */}
            <IonCol size="12" sizeMd="6">
              <IonCard className="ssr-card">
                <IonCardContent className="ssr-card-body">
                  <div className="ssr-card-head">
                    <IonText className="ssr-card-title">Cash Count</IonText>
                    <div className="ssr-total-chip">
                      Bills: <b>{peso(cashTotal)}</b> | Coins: <b>{peso(coinTotal)}</b>
                    </div>
                  </div>

                  <div className="ssr-cash-table">
                    <div className="ssr-cash-head">
                      <div className="ssr-ch">CASH</div>
                      <div className="ssr-ch ssr-ch--center">QTY</div>
                      <div className="ssr-ch ssr-ch--right">AMOUNT</div>
                    </div>

                    {lines
                      .filter((x) => x.money_kind === "cash")
                      .map((line) => {
                        const amount = line.denomination * line.qty;
                        return (
                          <div className="ssr-cash-row" key={`cash-${line.denomination}`}>
                            <div className="ssr-cd">{line.denomination}</div>
                            <div className="ssr-cq">
                              <IonInput
                                className="ssr-qty-input"
                                type="number"
                                inputmode="numeric"
                                disabled={submitting}
                                value={String(line.qty)}
                                onIonChange={(ev) => upsertQty(line, valueToNonNegInt(getDetailValue(ev)))}
                              />
                            </div>
                            <div className="ssr-ca">{peso(amount)}</div>
                          </div>
                        );
                      })}

                    <div className="ssr-cash-footer">
                      <div className="ssr-cash-footer-left">TOTAL CASH</div>
                      <div className="ssr-cash-footer-right">{peso(cashTotal)}</div>
                    </div>
                  </div>

                  <div className="ssr-coins-table">
                    <div className="ssr-cash-head">
                      <div className="ssr-ch">COINS</div>
                      <div className="ssr-ch ssr-ch--center">QTY</div>
                      <div className="ssr-ch ssr-ch--right">AMOUNT</div>
                    </div>

                    {lines
                      .filter((x) => x.money_kind === "coin")
                      .map((line) => {
                        const amount = line.denomination * line.qty;
                        return (
                          <div className="ssr-cash-row" key={`coin-${line.denomination}`}>
                            <div className="ssr-cd">{line.denomination}</div>
                            <div className="ssr-cq">
                              <IonInput
                                className="ssr-qty-input"
                                type="number"
                                inputmode="numeric"
                                disabled={submitting}
                                value={String(line.qty)}
                                onIonChange={(ev) => upsertQty(line, valueToNonNegInt(getDetailValue(ev)))}
                              />
                            </div>
                            <div className="ssr-ca">{peso(amount)}</div>
                          </div>
                        );
                      })}

                    <div className="ssr-cash-footer">
                      <div className="ssr-cash-footer-left">TOTAL COINS</div>
                      <div className="ssr-cash-footer-right">{peso(coinTotal)}</div>
                    </div>

                    <div className="ssr-coh-bar">
                      <span>COH / Total of the Day</span>
                      <b>{peso(cashTotal + coinTotal)}</b>
                    </div>
                  </div>

                  <div className="ssr-collected-wrap">
                    <div className="ssr-collected-box">
                      <div className="ssr-collected-label">Sales Collected</div>
                      <div className="ssr-collected-value">{peso(salesCollected)}</div>
                    </div>

                    <div className="ssr-collected-box ssr-collected-box--bilin">
                      <div className="ssr-collected-label">Bilin</div>
                      <IonInput
                        className="ssr-bilin-input"
                        type="number"
                        inputmode="decimal"
                        disabled={submitting}
                        value={report ? String(toNumber(report.bilin_amount)) : "0"}
                        onIonChange={(ev) => updateReportField("bilin_amount", valueToNonNegMoney(getDetailValue(ev)))}
                      />
                    </div>

                    <div className="ssr-collected-box ssr-collected-box--net">
                      <div className="ssr-collected-label">Net</div>
                      <div className="ssr-collected-value">{peso(netCollected)}</div>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>

              <IonCard className="ssr-card">
                <IonCardContent className="ssr-card-body">
                  <IonText className="ssr-card-title">Other Totals</IonText>

                  <div className="ssr-mini">
                    <div className="ssr-mini-row">
                      <span>Add-ons (Paid)</span>
                      <b>{peso(addons)}</b>
                    </div>
                    <div className="ssr-mini-row">
                      <span>Discount (amount)</span>
                      <b>{peso(discount)}</b>
                    </div>
                    <div className="ssr-mini-row">
                      <span>Total Time</span>
                      <b>{peso(totalTimeAmount)}</b>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonPage>
  );
};

export default AdminSalesReport;
