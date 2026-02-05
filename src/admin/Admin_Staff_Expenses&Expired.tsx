// src/pages/Admin_Staff_Expenses&Expired.tsx
// ✅ Admin view: staff expenses/expired logs + cash outs logs
// ✅ Date filter calendar (same style as Customer_Lists: date-pill)
// ✅ Same classnames as Customer_Lists for consistent CSS
// ✅ Expenses: Admin can DELETE (no revert) + VOID (reverts via trigger)
// ✅ Cash outs: Admin can DELETE (no revert)
// ✅ STRICT TS, NO any, NO unknown

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonToast,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonAlert,
} from "@ionic/react";
import { trashOutline, closeCircleOutline, refreshOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

type ExpenseType = "expired" | "staff_consumed";

type ExpenseRow = {
  id: string;
  created_at: string; // timestamptz
  add_on_id: string;
  full_name: string;
  category: string;
  product_name: string;
  quantity: number;
  expense_type: ExpenseType;
  description: string;
  voided: boolean;
  voided_at: string | null;
};

type ExpenseRowDB = {
  id: string;
  created_at: string;
  add_on_id: string;
  full_name: string | null;
  category: string | null;
  product_name: string | null;
  quantity: number | string | null;
  expense_type: string | null;
  description: string | null;
  voided: boolean | null;
  voided_at: string | null;
};

/* =========================
   CASH OUTS TYPES
========================= */

type CashOutRow = {
  id: string;
  created_at: string; // timestamptz
  created_by: string;
  cashout_date: string; // YYYY-MM-DD
  cashout_time: string; // HH:mm:ss
  type: string;
  description: string;
  amount: number;
};

type CashOutRowDB = {
  id: string;
  created_at: string;
  created_by: string;
  cashout_date: string | null;
  cashout_time: string | null;
  type: string | null;
  description: string | null;
  amount: number | string | null;
};

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString();
};

const typeLabel = (t: ExpenseType): string => (t === "expired" ? "Expired" : "Staff Consumed");

const toQty = (v: number | string | null): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const toMoney = (v: number | string | null): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const toExpenseType = (v: string | null): ExpenseType | null => {
  if (v === "expired") return "expired";
  if (v === "staff_consumed") return "staff_consumed";
  return null;
};

const peso = (n: number): string =>
  `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Admin_Staff_Expenses_Expired: React.FC = () => {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [cashOuts, setCashOuts] = useState<CashOutRow[]>([]);

  const [loading, setLoading] = useState<boolean>(true);

  const [toastOpen, setToastOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string>("");

  const [confirmVoid, setConfirmVoid] = useState<ExpenseRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseRow | null>(null);

  const [confirmDeleteCashOut, setConfirmDeleteCashOut] = useState<CashOutRow | null>(null);

  const [busyId, setBusyId] = useState<string>("");

  // ✅ Date filter (same pattern as Customer_Lists)
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  const fetchExpenses = async (): Promise<ExpenseRow[]> => {
    const { data, error } = await supabase
      .from("add_on_expenses")
      .select("id, created_at, add_on_id, full_name, category, product_name, quantity, expense_type, description, voided, voided_at")
      .order("created_at", { ascending: false })
      .returns<ExpenseRowDB[]>();

    if (error) throw error;

    const normalized: ExpenseRow[] = (data ?? [])
      .map((r): ExpenseRow | null => {
        const et = toExpenseType(r.expense_type);
        if (!et) return null;

        return {
          id: r.id,
          created_at: r.created_at,
          add_on_id: r.add_on_id,
          full_name: String(r.full_name ?? "").trim(),
          category: String(r.category ?? "").trim(),
          product_name: String(r.product_name ?? "").trim(),
          quantity: toQty(r.quantity),
          expense_type: et,
          description: String(r.description ?? "").trim(),
          voided: Boolean(r.voided ?? false),
          voided_at: r.voided_at ?? null,
        };
      })
      .filter((x): x is ExpenseRow => x !== null);

    return normalized;
  };

  const fetchCashOuts = async (): Promise<CashOutRow[]> => {
    const { data, error } = await supabase
      .from("cash_outs")
      .select("id, created_at, created_by, cashout_date, cashout_time, type, description, amount")
      .order("created_at", { ascending: false })
      .returns<CashOutRowDB[]>();

    if (error) throw error;

    const normalized: CashOutRow[] = (data ?? []).map((r) => {
      return {
        id: r.id,
        created_at: r.created_at,
        created_by: r.created_by,
        cashout_date: String(r.cashout_date ?? "").trim(),
        cashout_time: String(r.cashout_time ?? "").trim(),
        type: String(r.type ?? "").trim(),
        description: String(r.description ?? "").trim(),
        amount: toMoney(r.amount),
      };
    });

    return normalized;
  };

  const fetchAll = async (): Promise<void> => {
    setLoading(true);
    try {
      const [exp, co] = await Promise.all([fetchExpenses(), fetchCashOuts()]);
      setRows(exp);
      setCashOuts(co);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setToastMsg("Failed to load logs.");
      setToastOpen(true);
      setRows([]);
      setCashOuts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>): void => {
    void fetchAll().finally(() => event.detail.complete());
  };

  // ✅ Filter expenses by selectedDate using created_at local date
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const d = new Date(r.created_at);
      if (!Number.isFinite(d.getTime())) return false;
      return yyyyMmDdLocal(d) === selectedDate;
    });
  }, [rows, selectedDate]);

  // ✅ Filter cash outs by selectedDate using cashout_date (best)
  const filteredCashOuts = useMemo(() => {
    return cashOuts.filter((r) => r.cashout_date === selectedDate);
  }, [cashOuts, selectedDate]);

  const cashOutsTotal = useMemo(() => {
    return filteredCashOuts.reduce((sum, r) => sum + r.amount, 0);
  }, [filteredCashOuts]);

  const doVoid = async (r: ExpenseRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      const { error } = await supabase
        .from("add_on_expenses")
        .update({ voided: true })
        .eq("id", r.id)
        .eq("voided", false);

      if (error) throw error;

      setToastMsg("Voided. Stock/counts restored.");
      setToastOpen(true);
      await fetchAll();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setToastMsg("Failed to void record.");
      setToastOpen(true);
    } finally {
      setBusyId("");
    }
  };

  const doDelete = async (r: ExpenseRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      const { error } = await supabase.from("add_on_expenses").delete().eq("id", r.id);
      if (error) throw error;

      setToastMsg("Deleted log (no stock changes).");
      setToastOpen(true);
      await fetchAll();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setToastMsg("Failed to delete record.");
      setToastOpen(true);
    } finally {
      setBusyId("");
    }
  };

  const doDeleteCashOut = async (r: CashOutRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      const { error } = await supabase.from("cash_outs").delete().eq("id", r.id);
      if (error) throw error;

      setToastMsg("Deleted cash out.");
      setToastOpen(true);
      await fetchAll();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setToastMsg("Failed to delete cash out.");
      setToastOpen(true);
    } finally {
      setBusyId("");
    }
  };

  return (
    <IonPage>
      {/* ✅ SAME BACKGROUND as other pages */}
      <IonContent className="staff-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="customer-lists-container">
          {/* ✅ SAME TOPBAR LAYOUT as Customer_Lists */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Staff Expenses & Expired</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong>{" "}
                <span style={{ marginLeft: 8 }}>
                  (Expenses: <strong>{filteredRows.length}</strong> • Cash Outs:{" "}
                  <strong>{filteredCashOuts.length}</strong>)
                </span>
              </div>
            </div>

            <div className="customer-topbar-right">
              <IonButton className="receipt-btn" onClick={() => void fetchAll()} fill="outline">
                <IonIcon slot="start" icon={refreshOutline} />
                Refresh
              </IonButton>

              <label className="date-pill" style={{ marginLeft: 10 }}>
                <span className="date-pill-label">Date</span>
                <input
                  className="date-pill-input"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))}
                />
                <span className="date-pill-icon" aria-hidden="true">
                  📅
                </span>
              </label>
            </div>
          </div>

          {/* =========================
              EXPENSES TABLE
          ========================= */}
          {loading ? (
            <div className="customer-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <IonSpinner />
              <span>Loading...</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="customer-note">No EXPENSE records found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={`exp-${selectedDate}`}>
              <table className="customer-table admin-exp-table">
                <thead>
                  <tr>
                    <th>Full Name</th>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Qty</th>
                    <th>Type</th>
                    <th>Date & Time</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.id} className={r.voided ? "is-voided" : ""}>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{r.full_name || "—"}</span>
                          {r.voided && (
                            <span className="cell-sub">
                              <span className="pill pill--muted">VOIDED</span>
                              {r.voided_at ? ` • ${formatDateTime(r.voided_at)}` : ""}
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{r.product_name || "—"}</span>
                          <span className="cell-sub">{r.description || "—"}</span>
                        </div>
                      </td>

                      <td>{r.category || "—"}</td>

                      <td>
                        <span className="pill pill--dark">{r.quantity}</span>
                      </td>

                      <td>
                        <span className={`pill ${r.expense_type === "expired" ? "pill--warn" : "pill--info"}`}>
                          {typeLabel(r.expense_type)}
                        </span>
                      </td>

                      <td>{formatDateTime(r.created_at)}</td>

                      <td>
                        <div className="action-stack action-stack--row">
                          <button
                            className="receipt-btn btn-danger"
                            disabled={r.voided || busyId === r.id}
                            onClick={() => setConfirmVoid(r)}
                            title={r.voided ? "Already voided" : "Void (reverts stock via trigger)"}
                          >
                            <IonIcon icon={closeCircleOutline} />
                            <span style={{ marginLeft: 6 }}>{busyId === r.id ? "..." : "Void"}</span>
                          </button>

                          <button
                            className="receipt-btn btn-gray"
                            disabled={busyId === r.id}
                            onClick={() => setConfirmDelete(r)}
                            title="Delete log only (no revert)"
                          >
                            <IonIcon icon={trashOutline} />
                            <span style={{ marginLeft: 6 }}>{busyId === r.id ? "..." : "Delete"}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* =========================
              CASH OUTS TABLE (SEPARATE)
          ========================= */}
          <div style={{ marginTop: 18 }}>
            <div className="customer-topbar" style={{ padding: 0, marginBottom: 10 }}>
              <div className="customer-topbar-left">
                <h2 className="customer-lists-title" style={{ fontSize: 18, margin: 0 }}>
                  Cash Outs
                </h2>
                <div className="customer-subtext" style={{ marginTop: 4 }}>
                  Total cash outs for <strong>{selectedDate}</strong>: <strong>{peso(cashOutsTotal)}</strong>
                </div>
              </div>
            </div>

            {loading ? null : filteredCashOuts.length === 0 ? (
              <p className="customer-note">No CASH OUTS found for this date</p>
            ) : (
              <div className="customer-table-wrap" key={`co-${selectedDate}`}>
                <table className="customer-table admin-cashouts-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th>Date & Time</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredCashOuts.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="pill pill--info">{r.type || "—"}</span>
                        </td>
                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{r.description || "—"}</span>
                          </div>
                        </td>
                        <td>
                          <span className="pill pill--dark">{peso(r.amount)}</span>
                        </td>
                        <td>{formatDateTime(r.created_at)}</td>
                        <td>
                          <div className="action-stack action-stack--row">
                            <button
                              className="receipt-btn btn-gray"
                              disabled={busyId === r.id}
                              onClick={() => setConfirmDeleteCashOut(r)}
                              title="Delete cash out"
                            >
                              <IonIcon icon={trashOutline} />
                              <span style={{ marginLeft: 6 }}>{busyId === r.id ? "..." : "Delete"}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ALERTS */}
          <IonAlert
            isOpen={!!confirmVoid}
            onDidDismiss={() => setConfirmVoid(null)}
            header="Void this record?"
            message={
              confirmVoid
                ? `This will restore stock by reverting ${typeLabel(confirmVoid.expense_type)} (qty: ${confirmVoid.quantity}).`
                : ""
            }
            buttons={[
              { text: "Cancel", role: "cancel" },
              {
                text: "Void",
                role: "destructive",
                handler: () => {
                  const r = confirmVoid;
                  setConfirmVoid(null);
                  if (r) void doVoid(r);
                },
              },
            ]}
          />

          <IonAlert
            isOpen={!!confirmDelete}
            onDidDismiss={() => setConfirmDelete(null)}
            header="Delete this log?"
            message="This will delete the record only. Stock/counts will NOT change."
            buttons={[
              { text: "Cancel", role: "cancel" },
              {
                text: "Delete",
                role: "destructive",
                handler: () => {
                  const r = confirmDelete;
                  setConfirmDelete(null);
                  if (r) void doDelete(r);
                },
              },
            ]}
          />

          <IonAlert
            isOpen={!!confirmDeleteCashOut}
            onDidDismiss={() => setConfirmDeleteCashOut(null)}
            header="Delete this cash out?"
            message="This will delete the cash out record only."
            buttons={[
              { text: "Cancel", role: "cancel" },
              {
                text: "Delete",
                role: "destructive",
                handler: () => {
                  const r = confirmDeleteCashOut;
                  setConfirmDeleteCashOut(null);
                  if (r) void doDeleteCashOut(r);
                },
              },
            ]}
          />

          <IonToast isOpen={toastOpen} message={toastMsg} duration={2500} onDidDismiss={() => setToastOpen(false)} />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Staff_Expenses_Expired;
