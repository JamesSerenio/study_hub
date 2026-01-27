// src/pages/staff_sales_report.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonGrid,
  IonRow,
  IonCol,
  IonItem,
  IonLabel,
  IonInput,
  IonText,
  IonCard,
  IonCardContent,
  IonSpinner,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type MoneyKind = "cash" | "coin";

interface DailyReportRow {
  id: string;
  report_date: string;
  starting_cash: string | number;
  starting_gcash: string | number;
}

interface CashCountDBRow {
  id: string;
  report_id: string;
  money_kind: MoneyKind;
  denomination: string | number;
  qty: number;
  amount: string | number;
}

interface CashLine {
  report_id: string;
  money_kind: MoneyKind;
  denomination: number;
  qty: number;
}

interface SalesTotalsRow {
  report_date: string;
  coh_total: string | number;
  expenses_amount: string | number;

  paid_reservation_cash: string | number;
  paid_reservation_gcash: string | number;

  advance_cash: string | number;
  advance_gcash: string | number;

  walkin_cash: string | number;
  walkin_gcash: string | number;

  addons_total: string | number;
  discount_total: string | number;

  cash_sales: string | number;
  gcash_sales: string | number;

  system_sale: string | number;
}

const CASH_DENOMS: number[] = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMS: number[] = [10, 5, 1];

const toNumber = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const peso = (n: number): string => {
  return `₱${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const StaffSalesReport: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [report, setReport] = useState<DailyReportRow | null>(null);
  const [lines, setLines] = useState<CashLine[]>([]);
  const [totals, setTotals] = useState<SalesTotalsRow | null>(null);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const createOrLoadReport = async (): Promise<void> => {
    setLoading(true);

    await supabase
      .from("daily_sales_reports")
      .upsert(
        { report_date: today, starting_cash: 0, starting_gcash: 0 },
        { onConflict: "report_date" }
      );

    const { data, error } = await supabase
      .from("daily_sales_reports")
      .select("id, report_date, starting_cash, starting_gcash")
      .eq("report_date", today)
      .single();

    if (error) {
      console.error("load daily_sales_reports error:", error.message);
      setReport(null);
      setLoading(false);
      return;
    }

    setReport(data);
    setLoading(false);
  };

  const loadCashLines = async (reportId: string): Promise<void> => {
    const { data, error } = await supabase
      .from("daily_cash_count_lines")
      .select("id, report_id, money_kind, denomination, qty, amount")
      .eq("report_id", reportId);

    if (error) {
      console.error("load daily_cash_count_lines error:", error.message);
      return;
    }

    const rows: CashCountDBRow[] = data ?? [];
    const merged: CashLine[] = [];

    CASH_DENOMS.forEach((d) => {
      const row = rows.find(
        (r) => r.money_kind === "cash" && toNumber(r.denomination) === d
      );
      merged.push({
        report_id: reportId,
        money_kind: "cash",
        denomination: d,
        qty: row?.qty ?? 0,
      });
    });

    COIN_DENOMS.forEach((d) => {
      const row = rows.find(
        (r) => r.money_kind === "coin" && toNumber(r.denomination) === d
      );
      merged.push({
        report_id: reportId,
        money_kind: "coin",
        denomination: d,
        qty: row?.qty ?? 0,
      });
    });

    setLines(merged);
  };

  const loadTotals = async (): Promise<void> => {
    const { data, error } = await supabase
      .from("v_daily_sales_report_totals")
      .select(
        [
          "report_date",
          "coh_total",
          "expenses_amount",
          "paid_reservation_cash",
          "paid_reservation_gcash",
          "advance_cash",
          "advance_gcash",
          "walkin_cash",
          "walkin_gcash",
          "addons_total",
          "discount_total",
          "cash_sales",
          "gcash_sales",
          "system_sale",
        ].join(",")
      )
      .eq("report_date", today)
      .single();

    if (error) {
      console.error("load v_daily_sales_report_totals error:", error.message);
      setTotals(null);
      return;
    }

    setTotals(data);
  };

  const upsertQty = async (line: CashLine, qty: number): Promise<void> => {
    const safeQty = Number.isFinite(qty) && qty >= 0 ? Math.floor(qty) : 0;

    const { error } = await supabase.from("daily_cash_count_lines").upsert(
      {
        report_id: line.report_id,
        money_kind: line.money_kind,
        denomination: line.denomination,
        qty: safeQty,
      },
      { onConflict: "report_id,money_kind,denomination" }
    );

    if (error) {
      console.error("upsert qty error:", error.message);
      return;
    }

    setLines((prev) =>
      prev.map((x) =>
        x.money_kind === line.money_kind && x.denomination === line.denomination
          ? { ...x, qty: safeQty }
          : x
      )
    );

    await loadTotals();
  };

  const updateStarting = async (
    field: "starting_cash" | "starting_gcash",
    value: number
  ): Promise<void> => {
    if (!report) return;

    const safe = Number.isFinite(value) && value >= 0 ? value : 0;

    const { error } = await supabase
      .from("daily_sales_reports")
      .update({ [field]: safe })
      .eq("id", report.id);

    if (error) {
      console.error("update starting balance error:", error.message);
      return;
    }

    setReport((prev) => (prev ? { ...prev, [field]: safe } : prev));
    await loadTotals();
  };

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

  useEffect(() => {
    createOrLoadReport();
  }, []);

  useEffect(() => {
    if (!report) return;
    loadCashLines(report.id);
    loadTotals();
  }, [report?.id]);

  if (loading || !report) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <div className="ssr-loading">
            <IonSpinner />
            <IonText className="ssr-loading-text">Loading report…</IonText>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const startingCash = toNumber(report.starting_cash);
  const startingGcash = toNumber(report.starting_gcash);

  const coh = totals ? toNumber(totals.coh_total) : 0;
  const expensesAmount = totals ? toNumber(totals.expenses_amount) : 0;

  const cashSales = totals ? toNumber(totals.cash_sales) : 0;
  const gcashSales = totals ? toNumber(totals.gcash_sales) : 0;
  const addonsTotal = totals ? toNumber(totals.addons_total) : 0;
  const discountTotal = totals ? toNumber(totals.discount_total) : 0;
  const systemSale = totals ? toNumber(totals.system_sale) : 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Daily Sales Report</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div className="ssr-wrap">
          {/* HEADER */}
          <div className="ssr-header">
            <div className="ssr-header-left">
              <IonText className="ssr-title">Staff Sales Report</IonText>
              <IonText className="ssr-subtitle">
                Date: <b>{today}</b>
              </IonText>
            </div>
            <div className="ssr-header-right">
              <div className="ssr-pill">COH: {peso(coh)}</div>
              <div className="ssr-pill ssr-pill--muted">
                Expenses: {peso(expensesAmount)}
              </div>
            </div>
          </div>

          {/* STARTING BALANCE */}
          <IonCard className="ssr-card">
            <IonCardContent className="ssr-card-body">
              <IonText className="ssr-card-title">Starting Balance</IonText>

              <IonGrid className="ssr-grid">
                <IonRow className="ssr-grid-row">
                  <IonCol size="12" sizeMd="6">
                    <IonItem className="ssr-item" lines="none">
                      <IonLabel className="ssr-label" position="stacked">
                        Starting Cash
                      </IonLabel>
                      <IonInput
                        className="ssr-input"
                        type="number"
                        inputMode="decimal"
                        value={startingCash}
                        onIonChange={(e) =>
                          updateStarting(
                            "starting_cash",
                            Number(e.detail.value || 0)
                          )
                        }
                      />
                    </IonItem>
                  </IonCol>

                  <IonCol size="12" sizeMd="6">
                    <IonItem className="ssr-item" lines="none">
                      <IonLabel className="ssr-label" position="stacked">
                        Starting GCash
                      </IonLabel>
                      <IonInput
                        className="ssr-input"
                        type="number"
                        inputMode="decimal"
                        value={startingGcash}
                        onIonChange={(e) =>
                          updateStarting(
                            "starting_gcash",
                            Number(e.detail.value || 0)
                          )
                        }
                      />
                    </IonItem>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </IonCardContent>
          </IonCard>

          {/* CASH COUNT + COINS */}
          <IonCard className="ssr-card">
            <IonCardContent className="ssr-card-body">
              <div className="ssr-card-head">
                <IonText className="ssr-card-title">Cash Count</IonText>
                <div className="ssr-total-chip">
                  Bills: <b>{peso(cashTotal)}</b> &nbsp;|&nbsp; Coins:{" "}
                  <b>{peso(coinTotal)}</b>
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
                          onChange={(e) =>
                            upsertQty(line, Number(e.target.value || 0))
                          }
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

          {/* SUMMARY */}
          <IonCard className="ssr-card">
            <IonCardContent className="ssr-card-body">
              <IonText className="ssr-card-title">Summary</IonText>

              <div className="ssr-summary">
                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">COH Total</span>
                  <span className="ssr-sum-value">{peso(coh)}</span>
                </div>

                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">Expenses</span>
                  <span className="ssr-sum-value">{peso(expensesAmount)}</span>
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
                  <span className="ssr-sum-label">Add-Ons (Today)</span>
                  <span className="ssr-sum-value">{peso(addonsTotal)}</span>
                </div>

                <div className="ssr-sum-row">
                  <span className="ssr-sum-label">Discounts (Amount)</span>
                  <span className="ssr-sum-value">{peso(discountTotal)}</span>
                </div>

                <div className="ssr-divider" />

                <div className="ssr-system">
                  <div className="ssr-system-left">
                    <span className="ssr-system-title">System Sale</span>
                    <span className="ssr-system-sub">
                      (COH + Expenses + Paid Reservations) − (Starting Balance +
                      New Advance Payments)
                    </span>
                  </div>
                  <div className="ssr-system-right">{peso(systemSale)}</div>
                </div>
              </div>
            </IonCardContent>
          </IonCard>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default StaffSalesReport;
