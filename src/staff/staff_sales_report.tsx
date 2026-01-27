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
  IonDatetime,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type MoneyKind = "cash" | "coin";

interface DailyReportRow {
  id: string;
  report_date: string; // YYYY-MM-DD
  starting_cash: number | string;
  starting_gcash: number | string;
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
  report_date: string;
  coh_total: number | string;
  expenses_amount: number | string;

  paid_reservation_cash: number | string;
  paid_reservation_gcash: number | string;

  advance_cash: number | string;
  advance_gcash: number | string;

  walkin_cash: number | string;
  walkin_gcash: number | string;

  addons_total: number | string;
  discount_total: number | string;

  cash_sales: number | string;
  gcash_sales: number | string;

  system_sale: number | string;
}

const CASH_DENOMS: number[] = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMS: number[] = [10, 5, 1];

const toNumber = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toYYYYMMDD = (isoOrYmd: string): string => {
  // accepts "YYYY-MM-DD" or ISO like "YYYY-MM-DDTHH:mm:ss..."
  return isoOrYmd.slice(0, 10);
};

const StaffSalesReport: React.FC = () => {
  // store as YYYY-MM-DD for DB filtering
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  const [loading, setLoading] = useState<boolean>(true);
  const [report, setReport] = useState<DailyReportRow | null>(null);
  const [lines, setLines] = useState<CashLine[]>([]);
  const [totals, setTotals] = useState<SalesTotalsRow | null>(null);

  // IonDatetime wants ISO format
  const selectedDateISO = useMemo(() => `${selectedDate}T00:00:00`, [selectedDate]);

  const peso = (n: number): string =>
    `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const loadReport = async (dateYMD: string): Promise<void> => {
    setLoading(true);

    // create report row if missing
    const upsertRes = await supabase
      .from("daily_sales_reports")
      .upsert(
        { report_date: dateYMD, starting_cash: 0, starting_gcash: 0 },
        { onConflict: "report_date" }
      );

    if (upsertRes.error) {
      console.error("daily_sales_reports upsert error:", upsertRes.error.message);
      setLoading(false);
      return;
    }

    // fetch report
    const res = await supabase
      .from("daily_sales_reports")
      .select("id, report_date, starting_cash, starting_gcash")
      .eq("report_date", dateYMD)
      .single<DailyReportRow>();

    if (res.error) {
      console.error("daily_sales_reports select error:", res.error.message);
      setReport(null);
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
      const found = rows.find(
        (r) => r.money_kind === "cash" && toNumber(r.denomination) === d
      );
      merged.push({
        report_id: reportId,
        money_kind: "cash",
        denomination: d,
        qty: found?.qty ?? 0,
      });
    }

    for (const d of COIN_DENOMS) {
      const found = rows.find(
        (r) => r.money_kind === "coin" && toNumber(r.denomination) === d
      );
      merged.push({
        report_id: reportId,
        money_kind: "coin",
        denomination: d,
        qty: found?.qty ?? 0,
      });
    }

    setLines(merged);
  };

  const loadTotals = async (dateYMD: string): Promise<void> => {
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

    setTotals(res.data); // ✅ safe because single<SalesTotalsRow>()
  };

  const upsertQty = async (line: CashLine, qtyRaw: number): Promise<void> => {
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 0;

    const res = await supabase
      .from("daily_cash_count_lines")
      .upsert(
        {
          report_id: line.report_id,
          money_kind: line.money_kind,
          denomination: line.denomination,
          qty,
        },
        { onConflict: "report_id,money_kind,denomination" }
      );

    if (res.error) {
      console.error("daily_cash_count_lines upsert error:", res.error.message);
      return;
    }

    // update local state for instant UI feedback
    setLines((prev) =>
      prev.map((x) =>
        x.money_kind === line.money_kind && x.denomination === line.denomination
          ? { ...x, qty }
          : x
      )
    );

    await loadTotals(selectedDate);
  };

  // date filter change
  const onDateChange = (value: string | string[] | null | undefined): void => {
    if (!value) return;
    const v = Array.isArray(value) ? value[0] : value;
    if (!v) return;
    setSelectedDate(toYYYYMMDD(v));
  };

  // reload when date changes
  useEffect(() => {
    loadReport(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // reload lines & totals when report row changes
  useEffect(() => {
    if (!report) return;
    loadCashLines(report.id);
    loadTotals(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

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

  const coh = totals ? toNumber(totals.coh_total) : 0;
  const expenses = totals ? toNumber(totals.expenses_amount) : 0;
  const cashSales = totals ? toNumber(totals.cash_sales) : 0;
  const gcashSales = totals ? toNumber(totals.gcash_sales) : 0;
  const addons = totals ? toNumber(totals.addons_total) : 0;
  const discount = totals ? toNumber(totals.discount_total) : 0;
  const systemSale = totals ? toNumber(totals.system_sale) : 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Staff Sales Report</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* DATE FILTER */}
        <IonCard className="ssr-card">
          <IonCardContent className="ssr-card-body">
            <IonText className="ssr-card-title">Select Date</IonText>
            <IonDatetime
              className="ssr-datetime"
              presentation="date"
              value={selectedDateISO} // ✅ ISO
              onIonChange={(e) => onDateChange(e.detail.value)}
            />
          </IonCardContent>
        </IonCard>

        {/* CASH COUNT */}
        {report && (
          <IonCard className="ssr-card">
            <IonCardContent className="ssr-card-body">
              <div className="ssr-card-head">
                <IonText className="ssr-card-title">Cash Count</IonText>
                <div className="ssr-total-chip">
                  Bills: <b>{peso(cashTotal)}</b> | Coins: <b>{peso(coinTotal)}</b>
                </div>
              </div>

              <div className="ssr-table">
                <div className="ssr-table-head">
                  <div className="ssr-th">Type</div>
                  <div className="ssr-th">Denom</div>
                  <div className="ssr-th ssr-th--center">Qty</div>
                  <div className="ssr-th ssr-th--right">Amount</div>
                </div>

                {lines.map((line) => {
                  const amount = line.denomination * line.qty;
                  const kindLabel = line.money_kind === "cash" ? "CASH" : "COIN";

                  return (
                    <div
                      className="ssr-table-row"
                      key={`${line.money_kind}-${line.denomination}`}
                    >
                      <div className="ssr-td">
                        <span
                          className={`ssr-badge ${
                            line.money_kind === "cash"
                              ? "ssr-badge--cash"
                              : "ssr-badge--coin"
                          }`}
                        >
                          {kindLabel}
                        </span>
                      </div>

                      <div className="ssr-td">₱{line.denomination}</div>

                      <div className="ssr-td ssr-td--center">
                        <input
                          className="ssr-qty"
                          type="number"
                          min={0}
                          value={line.qty}
                          onChange={(ev) => upsertQty(line, Number(ev.target.value || 0))}
                        />
                      </div>

                      <div className="ssr-td ssr-td--right">{peso(amount)}</div>
                    </div>
                  );
                })}

                <div className="ssr-table-footer">
                  <div className="ssr-footer-left">COH / Total of the Day</div>
                  <div className="ssr-footer-right">
                    <b>{peso(cashTotal + coinTotal)}</b>
                  </div>
                </div>
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {/* TOTALS */}
        {totals && (
          <IonCard className="ssr-card">
            <IonCardContent className="ssr-card-body">
              <IonText className="ssr-card-title">Summary</IonText>

              <div className="ssr-summary">
                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">COH</span>
                  <span className="ssr-sum-value">{peso(coh)}</span>
                </div>
                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">Expenses</span>
                  <span className="ssr-sum-value">{peso(expenses)}</span>
                </div>
                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">Cash Sales</span>
                  <span className="ssr-sum-value">{peso(cashSales)}</span>
                </div>
                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">GCash Sales</span>
                  <span className="ssr-sum-value">{peso(gcashSales)}</span>
                </div>
                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">Add-ons</span>
                  <span className="ssr-sum-value">{peso(addons)}</span>
                </div>
                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">Discount (amount)</span>
                  <span className="ssr-sum-value">{peso(discount)}</span>
                </div>

                <div className="ssr-divider" />

                <div className="ssr-system">
                  <div className="ssr-system-left">
                    <span className="ssr-system-title">System Sale</span>
                    <span className="ssr-system-sub">
                      (COH + Expenses + Paid Reservations) − (Starting Balance + New Advance Payments)
                    </span>
                  </div>
                  <div className="ssr-system-right">{peso(systemSale)}</div>
                </div>
              </div>
            </IonCardContent>
          </IonCard>
        )}
      </IonContent>
    </IonPage>
  );
};

export default StaffSalesReport;
