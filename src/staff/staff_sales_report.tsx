// src/pages/staff_sales_report.tsx
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
} from "@ionic/react";
import { calendarOutline, closeOutline } from "ionicons/icons";
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
  gross: number;
  fee15: number;
  net: number;
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

const addDaysYMD = (ymd: string, days: number): string => {
  if (!isYMD(ymd)) return todayYMD();
  const [yy, mm, dd] = ymd.split("-").map((x) => Number(x));
  const d = new Date(yy, mm - 1, dd);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

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

const StaffSalesReport: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(() => todayYMD());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [loading, setLoading] = useState<boolean>(true);

  const [report, setReport] = useState<DailyReportRow | null>(null);
  const [lines, setLines] = useState<CashLine[]>([]);
  const [totals, setTotals] = useState<SalesTotalsRow | null>(null);

  // ✅ CONSIGNMENT (PAID ONLY)
  const [consignment, setConsignment] = useState<ConsignmentState>({ gross: 0, fee15: 0, net: 0 });

  // ✅ ADD-ONS (PAID ONLY)
  const [addonsPaid, setAddonsPaid] = useState<number>(0);

  // ✅ CASH OUTS TOTAL (cashout_date)
  const [cashOutsTotal, setCashOutsTotal] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; msg: string; color?: string }>(() => ({
    open: false,
    msg: "",
    color: "success",
  }));

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
      setCashOutsTotal(0);
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
      setCashOutsTotal(0);
      setLoading(false);
      return;
    }

    // ✅ if submitted date: staff sees zeros (hidden view)
    if (res.data?.is_submitted) {
      const r = res.data;
      setReport({ ...r, starting_cash: 0, starting_gcash: 0, bilin_amount: 0 });
      setLines(buildZeroLines(r.id));
      setTotals(null);
      setConsignment({ gross: 0, fee15: 0, net: 0 });
      setAddonsPaid(0);
      setCashOutsTotal(0);
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

    const res = await supabase.from("v_daily_sales_report_totals").select("*").eq("report_date", dateYMD).single<SalesTotalsRow>();

    if (res.error) {
      console.error("v_daily_sales_report_totals error:", res.error.message);
      setTotals(null);
      return;
    }

    setTotals(res.data);
  };

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

  const loadCashOutsTotal = async (dateYMD: string): Promise<void> => {
    if (!isYMD(dateYMD)) {
      setCashOutsTotal(0);
      return;
    }

    const res = await supabase.from("cash_outs").select("amount, cashout_date").eq("cashout_date", dateYMD);

    if (res.error) {
      console.error("cash_outs query error:", res.error.message);
      setCashOutsTotal(0);
      return;
    }

    const rows = (res.data ?? []) as Array<{ amount: number | string | null }>;
    const total = rows.reduce((sum, r) => sum + toNumber(r.amount), 0);
    setCashOutsTotal(total);
  };

  const upsertQty = async (line: CashLine, qty: number): Promise<void> => {
    if (submitting) return;

    // ✅ submitted date: local-only edit
    if (report?.is_submitted) {
      setLines((prev) =>
        prev.map((x) => (x.money_kind === line.money_kind && x.denomination === line.denomination ? { ...x, qty } : x))
      );
      return;
    }

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
      prev.map((x) => (x.money_kind === line.money_kind && x.denomination === line.denomination ? { ...x, qty } : x))
    );

    await loadTotals(selectedDate);
  };

  const updateReportField = async (field: "starting_cash" | "starting_gcash" | "bilin_amount", valueNum: number): Promise<void> => {
    if (!report || submitting) return;

    const safe = Math.max(0, valueNum);

    // ✅ submitted date: local-only edit
    if (report.is_submitted) {
      setReport((prev) => (prev ? { ...prev, [field]: safe } : prev));
      return;
    }

    const res = await supabase.from("daily_sales_reports").update({ [field]: safe }).eq("id", report.id);

    if (res.error) {
      console.error("daily_sales_reports update error:", res.error.message);
      return;
    }

    setReport((prev) => (prev ? { ...prev, [field]: safe } : prev));
    await loadTotals(selectedDate);
  };

  /* =========================
     SUBMIT / DONE
  ========================= */

  const goNextDay = (): void => {
    const next = addDaysYMD(isYMD(selectedDate) ? selectedDate : todayYMD(), 1);
    setReport(null);
    setLines([]);
    setTotals(null);
    setConsignment({ gross: 0, fee15: 0, net: 0 });
    setAddonsPaid(0);
    setCashOutsTotal(0);
    setSelectedDate(next);
  };

  const overwriteSaveForSameDate = async (): Promise<string | null> => {
    if (!report) return "No report loaded.";

    if (report.is_submitted) {
      const del = await supabase.from("daily_cash_count_lines").delete().eq("report_id", report.id);
      if (del.error) return del.error.message;
    }

    const r1 = await supabase
      .from("daily_sales_reports")
      .update({
        starting_cash: Math.max(0, toNumber(report.starting_cash)),
        starting_gcash: Math.max(0, toNumber(report.starting_gcash)),
        bilin_amount: Math.max(0, toNumber(report.bilin_amount)),
      })
      .eq("id", report.id);

    if (r1.error) return r1.error.message;

    const payload = lines.map((l) => ({
      report_id: l.report_id,
      money_kind: l.money_kind,
      denomination: l.denomination,
      qty: Math.max(0, Math.floor(toNumber(l.qty))),
    }));

    if (payload.length > 0) {
      const r2 = await supabase.from("daily_cash_count_lines").upsert(payload, { onConflict: "report_id,money_kind,denomination" });
      if (r2.error) return r2.error.message;
    }

    return null;
  };

  const onSubmitDone = async (): Promise<void> => {
    if (!report) return;

    if (!isYMD(selectedDate)) {
      setToast({ open: true, msg: "Invalid date. Use YYYY-MM-DD.", color: "danger" });
      return;
    }

    setSubmitting(true);

    const saveErr = await overwriteSaveForSameDate();
    if (saveErr) {
      setToast({ open: true, msg: `Save failed: ${saveErr}`, color: "danger" });
      setSubmitting(false);
      return;
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

    // ✅ make UI behave like others: after submit, totals hidden/zero
    setConsignment({ gross: 0, fee15: 0, net: 0 });
    setAddonsPaid(0);
    setCashOutsTotal(0);

    setToast({ open: true, msg: `DONE saved for ${selectedDate}. Moving to next day…`, color: "success" });

    setSubmitting(false);
    goNextDay();
  };

  /* =========================
     LOAD when date changes
  ========================= */

  useEffect(() => {
    void (async () => {
      await loadReport(selectedDate);

      if (!isYMD(selectedDate)) {
        setConsignment({ gross: 0, fee15: 0, net: 0 });
        setAddonsPaid(0);
        setCashOutsTotal(0);
        return;
      }

      const check = await supabase.from("daily_sales_reports").select("is_submitted").eq("report_date", selectedDate).single<{ is_submitted: boolean }>();
      const isSubmitted = Boolean(check.data?.is_submitted);

      if (isSubmitted) {
        setConsignment({ gross: 0, fee15: 0, net: 0 });
        setAddonsPaid(0);
        setCashOutsTotal(0);
      } else {
        void loadConsignment(selectedDate);
        void loadAddonsPaid(selectedDate);
        void loadCashOutsTotal(selectedDate);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (!report) return;

    if (report.is_submitted) {
      setLines(buildZeroLines(report.id));
      setTotals(null);
      return;
    }

    void loadCashLines(report.id);
    void loadTotals(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  /* =========================
     COMPUTED
  ========================= */

  const cashTotal = useMemo(() => {
    return lines.filter((l) => l.money_kind === "cash").reduce((sum, l) => sum + l.denomination * l.qty, 0);
  }, [lines]);

  const coinTotal = useMemo(() => {
    return lines.filter((l) => l.money_kind === "coin").reduce((sum, l) => sum + l.denomination * l.qty, 0);
  }, [lines]);

  const expenses = totals ? toNumber(totals.expenses_amount) : 0;
  const cashSales = totals ? toNumber(totals.cash_sales) : 0;
  const gcashSales = totals ? toNumber(totals.gcash_sales) : 0;

  // ✅ COH: cash from cash count, gcash from gcashSales
  const cohCash = cashTotal + coinTotal;
  const cohGcash = gcashSales;

  // ✅ SHOW VALUES (UI)
  const paidResCash = totals ? toNumber(totals.paid_reservation_cash) : 0;
  const paidResGcash = totals ? toNumber(totals.paid_reservation_gcash) : 0;

  const advCash = totals ? toNumber(totals.advance_cash) : 0;
  const advGcash = totals ? toNumber(totals.advance_gcash) : 0;

  const dpCash = totals ? toNumber(totals.walkin_cash) : 0;
  const dpGcash = totals ? toNumber(totals.walkin_gcash) : 0;

  const startingCash = report ? toNumber(report.starting_cash) : 0;
  const startingGcash = report ? toNumber(report.starting_gcash) : 0;

  const addons = addonsPaid;
  const discount = totals ? toNumber(totals.discount_total) : 0;

  const bilin = report ? toNumber(report.bilin_amount) : 0;

  /**
   * ✅ FIXED PER YOUR REQUEST:
   * - DO NOT include gcash from:
   *   Paid reservations / New Advance / Down payments
   *
   * Sales System =
   *   (COH cash + COH gcash)
   * + Paid reservations CASH
   * + New advance CASH
   * + Down payments CASH
   * - Starting Balance (cash + gcash)
   */
  const salesSystem =
    cohCash +
    cohGcash +
    paidResCash +
    advCash +
    dpCash -
    (startingCash + startingGcash);

  /**
   * ✅ Sales Collected:
   * - same base as Sales System
   * - auto minus Bilin
   */
  const salesCollectedDisplay = salesSystem - bilin;

  const totalTimeAmount = (totals ? toNumber(totals.walkin_cash) : 0) + (totals ? toNumber(totals.walkin_gcash) : 0);

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

  const submitLabel = report?.is_submitted ? "DONE / UPDATE" : "DONE / SUBMIT";

  return (
    <IonPage>
      <IonHeader></IonHeader>

      <IonContent className="ion-padding ssr-page">
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2400}
          onDidDismiss={() => setToast((p) => ({ ...p, open: false }))}
        />

        {/* DATE + SUBMIT */}
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
                  Status: <b>{report?.is_submitted ? "SUBMITTED (hidden view, overwrite on submit)" : "DRAFT"}</b>
                  {report?.submitted_at ? (
                    <span style={{ marginLeft: 8 }}>(last submit: {new Date(report.submitted_at).toLocaleString()})</span>
                  ) : null}
                </div>
              </div>

              <IonButton strong disabled={submitting || !report} onClick={() => void onSubmitDone()}>
                {submitting ? "Saving..." : submitLabel}
              </IonButton>
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

                  {/* COH */}
                  <div className="ssr-left-row">
                    <div className="ssr-left-label">COH / Total of the Day</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(cohCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(cohGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Expenses</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(expenses)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">—</div>
                  </div>

                  {/* ✅ DISPLAY GCASH AGAIN (but NOT used in salesSystem formula) */}
                  <div className="ssr-left-row ssr-left-row--tint">
                    <div className="ssr-left-label">Paid reservations for this date</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(paidResCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(paidResGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">New Advance Payments</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(advCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(advGcash)}</div>
                  </div>

                  <div className="ssr-left-row">
                    <div className="ssr-left-label">Down payments within this date only</div>
                    <div className="ssr-left-value ssr-left-value--cash">{peso(dpCash)}</div>
                    <div className="ssr-left-value ssr-left-value--gcash">{peso(dpGcash)}</div>
                  </div>

                  {/* ✅ Sales System (uses ONLY CASH for the 3 rows above) */}
                  <div className="ssr-left-row ssr-left-row--system">
                    <div className="ssr-left-label">Sales System</div>
                    <div className="ssr-left-value ssr-left-value--system ssr-span-2">{peso(salesSystem)}</div>
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

                  {/* CONSIGNMENT + CASH OUTS */}
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
                    <div className="ssr-sales-box">
                      <span className="ssr-sales-box-label">Cash Outs</span>
                      <span className="ssr-sales-box-value">{peso(cashOutsTotal)}</span>
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
                      Cash: <b>{peso(cashTotal)}</b> | Coins: <b>{peso(coinTotal)}</b>
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
                      <b>{peso(cohCash)}</b>
                    </div>
                  </div>

                  <div className="ssr-collected-wrap">
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

                    {/* ✅ Sales Collected = Sales System - Bilin */}
                    <div className="ssr-collected-box ssr-collected-box--net">
                      <div className="ssr-collected-label">Sales Collected</div>
                      <div className="ssr-collected-value">{peso(salesCollectedDisplay)}</div>
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

export default StaffSalesReport;
