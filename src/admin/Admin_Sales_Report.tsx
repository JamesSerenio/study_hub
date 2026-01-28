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

/* =========================
   CONSTANTS
========================= */

const CASH_DENOMS: number[] = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMS: number[] = [20, 10, 5, 1]; // ✅ matches your sheet style (20/10/5/1)

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
   TIME DISPLAY (hours -> hr/min)
========================= */

const fmtHoursSmart = (hoursRaw: number): string => {
  const hours = Number.isFinite(hoursRaw) ? Math.max(0, hoursRaw) : 0;

  const totalMins = Math.round(hours * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;

  if (h === 0 && m === 0) return "0 min";
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr${h === 1 ? "" : "s"}`;
  return `${h} hr${h === 1 ? "" : "s"} ${m} min`;
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
   CSV HELPERS (Export to Excel)
   ✅ UTF-8 BOM
========================= */

const csvEscape = (s: string): string => {
  // Wrap in quotes if needed
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const downloadCSV = (filename: string, rows: string[][]): void => {
  const bom = "\uFEFF"; // ✅ Excel-friendly UTF-8 BOM
  const csv = rows.map((r) => r.map((c) => csvEscape(c)).join(",")).join("\n");
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; msg: string; color?: string }>({
    open: false,
    msg: "",
    color: "success",
  });

  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);

  /* =========================
     LOAD / ENSURE REPORT
     ✅ ensure row exists WITHOUT overwriting existing data
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
      // still show zeros so UI is usable
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
     ADMIN: DONE / UPDATE (always saves + marks submitted)
     ✅ Admin can revisit previous dates and SEE values and EDIT them
  ========================= */

  const onSubmitDone = async (): Promise<void> => {
    if (!report) return;

    if (!isYMD(selectedDate)) {
      setToast({ open: true, msg: "Invalid date. Use YYYY-MM-DD.", color: "danger" });
      return;
    }

    setSubmitting(true);

    // Save header fields (overwrite)
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

    // Save cash lines (overwrite via upsert)
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

    // Mark submitted (admin: always keep values visible)
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

    setToast({ open: true, msg: `Saved for ${selectedDate}.`, color: "success" });
    setSubmitting(false);
  };

  /* =========================
     ADMIN: DELETE BY DATE
     ✅ deletes only that date
  ========================= */

  const deleteByDate = async (): Promise<void> => {
    if (!isYMD(selectedDate)) {
      setToast({ open: true, msg: "Invalid date.", color: "danger" });
      return;
    }

    setSubmitting(true);

    // Find report row first (if none, nothing to delete)
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

    // Delete lines first (safe even if none)
    const d1 = await supabase.from("daily_cash_count_lines").delete().eq("report_id", reportId);
    if (d1.error) {
      setToast({ open: true, msg: `Delete lines failed: ${d1.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    // Delete report
    const d2 = await supabase.from("daily_sales_reports").delete().eq("id", reportId);
    if (d2.error) {
      setToast({ open: true, msg: `Delete report failed: ${d2.error.message}`, color: "danger" });
      setSubmitting(false);
      return;
    }

    setToast({ open: true, msg: `Deleted report for ${selectedDate}.`, color: "success" });

    // Reload this date -> ensureReportRow recreates a fresh blank row
    await loadReport(selectedDate);
    setSubmitting(false);
  };

  /* =========================
     EXPORT TO EXCEL (CSV)
     ✅ "formal" layout style like your sheet (Category + Cash Count)
  ========================= */

  const exportToExcel = (): void => {
    if (!report || !isYMD(selectedDate)) {
      setToast({ open: true, msg: "Pick a valid date first.", color: "danger" });
      return;
    }

    const cashLines = lines.filter((x) => x.money_kind === "cash");
    const coinLines = lines.filter((x) => x.money_kind === "coin");

    const cashTotal = cashLines.reduce((sum, l) => sum + l.denomination * l.qty, 0);
    const coinTotal = coinLines.reduce((sum, l) => sum + l.denomination * l.qty, 0);

    const coh = totals ? toNumber(totals.coh_total) : 0;
    const salesCollected = totals ? toNumber(totals.sales_collected) : coh;
    const bilin = report ? toNumber(report.bilin_amount) : 0;
    const netCollected = totals ? toNumber(totals.net_collected) : salesCollected - bilin;

    const expenses = totals ? toNumber(totals.expenses_amount) : 0;
    const cashSales = totals ? toNumber(totals.cash_sales) : 0;
    const gcashSales = totals ? toNumber(totals.gcash_sales) : 0;
    const addons = totals ? toNumber(totals.addons_total) : 0;
    const discount = totals ? toNumber(totals.discount_total) : 0;
    const systemSale = totals ? toNumber(totals.system_sale) : 0;
    const totalTimeHours = totals ? toNumber(totals.total_time) : 0;

    const paidResCash = totals ? toNumber(totals.paid_reservation_cash) : 0;
    const paidResGcash = totals ? toNumber(totals.paid_reservation_gcash) : 0;

    const advCash = totals ? toNumber(totals.advance_cash) : 0;
    const advGcash = totals ? toNumber(totals.advance_gcash) : 0;

    const walkCash = totals ? toNumber(totals.walkin_cash) : 0;
    const walkGcash = totals ? toNumber(totals.walkin_gcash) : 0;

    // Make a grid-like CSV (with empty columns as spacing)
    // Columns: A..M style: [Category, Cash, GCash, (blank), (blank), (blank), CashDenom, Qty, Amount, (blank), CoinDenom, Qty, Amount]
    const rows: string[][] = [];

    // Title + Date (force as text with leading apostrophe)
    rows.push(["DAILY SALES REPORT", "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Report Date", `'${selectedDate}`, "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Status", report.is_submitted ? "SUBMITTED" : "DRAFT", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Submitted At", report.submitted_at ? new Date(report.submitted_at).toLocaleString() : "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["", "", "", "", "", "", "", "", "", "", "", "", ""]);

    // Headers
    rows.push(["CATEGORY", "CASH", "GCASH", "", "", "", "CASH COUNT", "", "", "", "COINS", "", ""]);
    rows.push(["", "", "", "", "", "", "CASH", "QTY", "AMOUNT", "", "COINS", "QTY", "AMOUNT"]);

    // Left table (like your sheet)
    rows.push(["Starting Balance", String(toNumber(report.starting_cash)), String(toNumber(report.starting_gcash)), "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["COH / Total of the Day", peso(cashTotal + coinTotal), "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Expenses", String(expenses), "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Paid reservations for today", String(paidResCash), String(paidResGcash), "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["New Advance Payments", String(advCash), String(advGcash), "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Down payments within this day only", String(walkCash), String(walkGcash), "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Sales System", String(systemSale), "", "", "", "", "", "", "", "", "", "", ""]);

    // Cash count rows (align cash + coins side by side like the sheet)
    const maxLen = Math.max(cashLines.length, coinLines.length);
    for (let i = 0; i < maxLen; i++) {
      const c = cashLines[i];
      const k = coinLines[i];

      const cashDen = c ? String(c.denomination) : "";
      const cashQty = c ? String(c.qty) : "";
      const cashAmt = c ? peso(c.denomination * c.qty) : "";

      const coinDen = k ? String(k.denomination) : "";
      const coinQty = k ? String(k.qty) : "";
      const coinAmt = k ? peso(k.denomination * k.qty) : "";

      rows.push(["", "", "", "", "", "", cashDen, cashQty, cashAmt, "", coinDen, coinQty, coinAmt]);
    }

    // Totals bars like the sheet bottom
    rows.push(["", "", "", "", "", "", "TOTAL CASH", "", peso(cashTotal), "", "TOTAL COINS", "", peso(coinTotal)]);
    rows.push(["", "", "", "", "", "", "", "", "", "", "", "", ""]);

    // Sales boxes area
    rows.push(["Cash Sales", peso(cashSales), "", "", "", "", "Sales Collected", peso(salesCollected), "", "", "", "", ""]);
    rows.push(["Gcash Sales", peso(gcashSales), "", "", "", "", "Bilin", String(Math.max(0, bilin)), "", "", "", "", ""]);
    rows.push(["", "", "", "", "", "", "Net", peso(netCollected), "", "", "", "", ""]);
    rows.push(["", "", "", "", "", "", "", "", "", "", "", "", ""]);

    // Checking block
    rows.push(["CHECKING", "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Sales System", String(systemSale), "", "", "", "", "Actual", peso(cashSales + gcashSales), "", "", "", "", ""]);
    rows.push(["", "", "", "", "", "", "", "", "", "", "", "", ""]);

    // Other totals
    rows.push(["Time", fmtHoursSmart(totalTimeHours), "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Add-ons", peso(addons), "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["Discounts", peso(discount), "", "", "", "", "", "", "", "", "", "", ""]);

    const filename = `Daily_Sales_Report_${selectedDate}.csv`;
    downloadCSV(filename, rows);

    setToast({ open: true, msg: "Exported CSV (Excel-ready).", color: "success" });
  };

  /* =========================
     LOAD when date changes
  ========================= */

  useEffect(() => {
    void loadReport(selectedDate);
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
  const addons = totals ? toNumber(totals.addons_total) : 0;
  const discount = totals ? toNumber(totals.discount_total) : 0;
  const systemSale = totals ? toNumber(totals.system_sale) : 0;

  const totalTimeHours = totals ? toNumber(totals.total_time) : 0;

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
            {
              text: "Delete",
              role: "destructive",
              handler: () => void deleteByDate(),
            },
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
                    <span style={{ marginLeft: 8 }}>
                      (last submit: {new Date(report.submitted_at).toLocaleString()})
                    </span>
                  ) : null}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <IonButton
                  color="medium"
                  fill="outline"
                  disabled={submitting || !report}
                  onClick={() => exportToExcel()}
                >
                  <IonIcon slot="start" icon={downloadOutline} />
                  Export
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
                          onIonChange={(ev) =>
                            updateReportField("starting_cash", valueToNonNegMoney(getDetailValue(ev)))
                          }
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
                          onIonChange={(ev) =>
                            updateReportField("starting_gcash", valueToNonNegMoney(getDetailValue(ev)))
                          }
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
                    <div className="ssr-left-value ssr-left-value--cash">
                      {peso(totals ? toNumber(totals.advance_cash) : 0)}
                    </div>
                    <div className="ssr-left-value ssr-left-value--gcash">
                      {peso(totals ? toNumber(totals.advance_gcash) : 0)}
                    </div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Down payments within this day only</div>
                    <div className="ssr-left-value ssr-left-value--cash">
                      {peso(totals ? toNumber(totals.walkin_cash) : 0)}
                    </div>
                    <div className="ssr-left-value ssr-left-value--gcash">
                      {peso(totals ? toNumber(totals.walkin_gcash) : 0)}
                    </div>
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

                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                    Total Time: <b>{fmtHoursSmart(totalTimeHours)}</b> | Add-ons: <b>{peso(addons)}</b> | Discount:{" "}
                    <b>{peso(discount)}</b>
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
                        onIonChange={(ev) =>
                          updateReportField("bilin_amount", valueToNonNegMoney(getDetailValue(ev)))
                        }
                      />
                    </div>

                    <div className="ssr-collected-box ssr-collected-box--net">
                      <div className="ssr-collected-label">Net</div>
                      <div className="ssr-collected-value">{peso(netCollected)}</div>
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
