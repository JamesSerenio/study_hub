// src/pages/Customer_Add_ons.tsx
// ✅ UI MATCHES Customer_Lists (TOPBAR + DATE PILL CALENDAR + TABLE WRAP + NOTES)
// ✅ Same className + UI style as Customer_Lists (customer-lists-container, customer-topbar, date-pill, customer-table-wrap, customer-table, receipt-overlay, etc.)
// ✅ Payment modal: GCash/Cash auto updates to match Due
// ✅ Save Payment auto sets PAID/UNPAID (paid >= due) + paid_at
// ✅ Manual PAID/UNPAID toggle works (can return to UNPAID even if fully paid)
// ✅ Receipt status follows manual is_paid (like Customer_Lists)
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

type NumericLike = number | string;

interface AddOnInfo {
  id: string;
  name: string;
  category: string;
}

interface CustomerSessionAddOnRow {
  id: string;
  created_at: string;
  add_on_id: string;
  quantity: number;
  price: NumericLike;
  total: NumericLike;
  full_name: string;
  seat_number: string;

  gcash_amount: NumericLike;
  cash_amount: NumericLike;
  is_paid: boolean | number | string | null;
  paid_at: string | null;
}

interface CustomerAddOnMerged {
  id: string;
  created_at: string;
  add_on_id: string;
  quantity: number;
  price: number;
  total: number;
  full_name: string;
  seat_number: string;
  item_name: string;
  category: string;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;
}

type OrderItem = {
  id: string;
  category: string;
  item_name: string;
  quantity: number;
  price: number;
  total: number;
};

type OrderGroup = {
  key: string;
  created_at: string;
  full_name: string;
  seat_number: string;

  items: OrderItem[];
  grand_total: number;

  gcash_amount: number;
  cash_amount: number;

  // ✅ manual paid status (from DB)
  is_paid: boolean;
  paid_at: string | null;
};

/* ---------------- helpers ---------------- */

const toNumber = (v: NumericLike | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const round2 = (n: number): number => Number((Number.isFinite(n) ? n : 0).toFixed(2));

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const extractDate = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return yyyyMmDdLocal(d);
};

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

const ms = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const moneyText = (n: number): string => `₱${round2(n).toFixed(2)}`;

// keep gcash (clamp to due), cash = remaining
const recalcPaymentsToDue = (due: number, gcash: number): { gcash: number; cash: number } => {
  const d = round2(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const g = round2(Math.min(d, Math.max(0, gcash)));
  const c = round2(Math.max(0, d - g));
  return { gcash: g, cash: c };
};

// group window: rows created within 10s = one order
const GROUP_WINDOW_MS = 10_000;

const samePersonSeat = (a: CustomerAddOnMerged, b: CustomerAddOnMerged): boolean =>
  norm(a.full_name) === norm(b.full_name) && norm(a.seat_number) === norm(b.seat_number);

/* ---------------- component ---------------- */

const Customer_Add_ons: React.FC = () => {
  const [records, setRecords] = useState<CustomerAddOnMerged[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Date filter (same behavior as Customer_Lists)
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // receipt modal
  const [selectedOrder, setSelectedOrder] = useState<OrderGroup | null>(null);

  // payment modal
  const [paymentTarget, setPaymentTarget] = useState<OrderGroup | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // paid toggle busy
  const [togglingPaidKey, setTogglingPaidKey] = useState<string | null>(null);

  useEffect(() => {
    void fetchAddOns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAddOns = async (): Promise<void> => {
    setLoading(true);

    const { data: rows, error } = await supabase
      .from("customer_session_add_ons")
      .select(
        `
        id,
        created_at,
        add_on_id,
        quantity,
        price,
        total,
        full_name,
        seat_number,
        gcash_amount,
        cash_amount,
        is_paid,
        paid_at
      `
      )
      .order("created_at", { ascending: false })
      .returns<CustomerSessionAddOnRow[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("Error fetching add-ons:", error);
      setRecords([]);
      setLoading(false);
      return;
    }

    const sessionRows = rows ?? [];
    if (sessionRows.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    const addOnIds = Array.from(new Set(sessionRows.map((r) => r.add_on_id)));

    const { data: addOnRows, error: addOnErr } = await supabase
      .from("add_ons")
      .select("id, name, category")
      .in("id", addOnIds)
      .returns<AddOnInfo[]>();

    if (addOnErr) {
      // eslint-disable-next-line no-console
      console.error("Error fetching add_ons:", addOnErr);
    }

    const addOnMap = new Map<string, AddOnInfo>();
    (addOnRows ?? []).forEach((a) => addOnMap.set(a.id, a));

    const merged: CustomerAddOnMerged[] = sessionRows.map((r) => {
      const addOn = addOnMap.get(r.add_on_id);

      return {
        id: r.id,
        created_at: r.created_at,
        add_on_id: r.add_on_id,
        quantity: Number.isFinite(r.quantity) ? r.quantity : 0,
        price: toNumber(r.price),
        total: toNumber(r.total),
        full_name: r.full_name,
        seat_number: r.seat_number,
        item_name: addOn?.name ?? "-",
        category: addOn?.category ?? "-",

        gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount))),
        cash_amount: round2(Math.max(0, toNumber(r.cash_amount))),
        is_paid: toBool(r.is_paid),
        paid_at: r.paid_at ?? null,
      };
    });

    setRecords(merged);
    setLoading(false);
  };

  const filteredRecords = useMemo(() => {
    return records
      .filter((r) => extractDate(r.created_at) === selectedDate)
      .sort((a, b) => ms(a.created_at) - ms(b.created_at)); // ascending for grouping window
  }, [records, selectedDate]);

  const groupedOrders = useMemo<OrderGroup[]>(() => {
    if (filteredRecords.length === 0) return [];

    const groups: OrderGroup[] = [];
    let current: OrderGroup | null = null;
    let lastRow: CustomerAddOnMerged | null = null;

    for (const row of filteredRecords) {
      const startNew =
        current === null ||
        lastRow === null ||
        !samePersonSeat(row, lastRow) ||
        Math.abs(ms(row.created_at) - ms(lastRow.created_at)) > GROUP_WINDOW_MS;

      if (startNew) {
        const key = `${norm(row.full_name)}|${norm(row.seat_number)}|${ms(row.created_at)}`;

        current = {
          key,
          created_at: row.created_at,
          full_name: row.full_name,
          seat_number: row.seat_number,
          items: [],
          grand_total: 0,

          gcash_amount: 0,
          cash_amount: 0,

          // ✅ manual (do not auto override later)
          is_paid: false,
          paid_at: null,
        };

        groups.push(current);
      }

      if (!current) continue;

      current.items.push({
        id: row.id,
        category: row.category,
        item_name: row.item_name,
        quantity: Number(row.quantity) || 0,
        price: row.price,
        total: row.total,
      });

      current.grand_total = round2(current.grand_total + row.total);

      // aggregate payment
      current.gcash_amount = round2(current.gcash_amount + row.gcash_amount);
      current.cash_amount = round2(current.cash_amount + row.cash_amount);

      // ✅ manual status from DB (if any row paid => show paid)
      current.is_paid = current.is_paid || row.is_paid;
      current.paid_at = current.paid_at ?? row.paid_at;

      lastRow = row;
    }

    // ✅ IMPORTANT: do NOT auto-compute paid here, so toggle can return to UNPAID
    return groups.sort((a, b) => ms(b.created_at) - ms(a.created_at));
  }, [filteredRecords]);

  // -----------------------
  // PAYMENT MODAL
  // -----------------------
  const openPaymentModal = (o: OrderGroup): void => {
    const due = round2(Math.max(0, o.grand_total));

    const existingTotalPaid = round2(o.gcash_amount + o.cash_amount);
    const existingGcash = existingTotalPaid > 0 ? o.gcash_amount : 0;

    const adj = recalcPaymentsToDue(due, existingGcash);

    setPaymentTarget(o);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setGcashAndAutoCash = (o: OrderGroup, gcashStr: string): void => {
    const due = round2(Math.max(0, o.grand_total));
    const gc = round2(Math.max(0, Number(gcashStr) || 0));
    const adj = recalcPaymentsToDue(due, gc);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setCashAndAutoGcash = (o: OrderGroup, cashStr: string): void => {
    const due = round2(Math.max(0, o.grand_total));
    const ca = round2(Math.max(0, Number(cashStr) || 0));

    const cash = round2(Math.min(due, ca));
    const gcash = round2(Math.max(0, due - cash));

    setCashInput(String(cash));
    setGcashInput(String(gcash));
  };

  // ✅ Save payment updates ALL rows in the order
  // ✅ Auto set is_paid based on payment vs due
  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = round2(Math.max(0, paymentTarget.grand_total));
    const gcIn = round2(Math.max(0, Number(gcashInput) || 0));
    const adj = recalcPaymentsToDue(due, gcIn);

    const totalPaid = round2(adj.gcash + adj.cash);
    const isPaidAuto = due > 0 && totalPaid >= due;

    const itemIds = paymentTarget.items.map((x) => x.id);

    try {
      setSavingPayment(true);

      const { error } = await supabase
        .from("customer_session_add_ons")
        .update({
          gcash_amount: adj.gcash,
          cash_amount: adj.cash,
          is_paid: isPaidAuto, // ✅ auto paid on save
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .in("id", itemIds);

      if (error) {
        alert(`Save payment error: ${error.message}`);
        return;
      }

      setPaymentTarget(null);
      await fetchAddOns();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  // -----------------------
  // PAID / UNPAID TOGGLE (manual) — updates ALL rows
  // -----------------------
  const togglePaid = async (o: OrderGroup): Promise<void> => {
    const itemIds = o.items.map((x) => x.id);

    try {
      setTogglingPaidKey(o.key);

      const nextPaid = !toBool(o.is_paid);

      const { error } = await supabase
        .from("customer_session_add_ons")
        .update({
          is_paid: nextPaid,
          paid_at: nextPaid ? new Date().toISOString() : null,
        })
        .in("id", itemIds);

      if (error) {
        alert(`Toggle paid error: ${error.message}`);
        return;
      }

      await fetchAddOns();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidKey(null);
    }
  };

  return (
    <IonPage>
      {/* ✅ SAME BACKGROUND as Customer_Lists */}
      <IonContent scrollY={false} className="staff-content">
        <div className="customer-lists-container">
          {/* ✅ SAME TOPBAR + SAME DATE PILL CALENDAR as Customer_Lists */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Customer Add-Ons Records</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong>
              </div>
            </div>

            <div className="customer-topbar-right">
              <label className="date-pill">
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

              {/* ✅ refresh button (kept) but uses SAME button class as tables */}
              <button className="receipt-btn" onClick={() => void fetchAddOns()} style={{ whiteSpace: "nowrap" }}>
                Refresh
              </button>
            </div>
          </div>

          {/* TABLE */}
          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : groupedOrders.length === 0 ? (
            <p className="customer-note">No add-ons found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={selectedDate}>
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Full Name</th>
                    <th>Seat</th>
                    <th>Items</th>
                    <th>Grand Total</th>
                    <th>Payment</th>
                    <th>Paid?</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {groupedOrders.map((o) => {
                    const due = round2(o.grand_total);
                    const totalPaid = round2(o.gcash_amount + o.cash_amount);
                    const remaining = round2(Math.max(0, due - totalPaid));

                    // ✅ IMPORTANT: show PAID based on manual is_paid only
                    const paid = toBool(o.is_paid);

                    return (
                      <tr key={o.key}>
                        <td>{new Date(o.created_at).toLocaleString("en-PH")}</td>
                        <td>{o.full_name || "-"}</td>
                        <td>{o.seat_number || "-"}</td>

                        <td>
                          <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
                            {o.items.map((it) => (
                              <div
                                key={it.id}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  borderBottom: "1px solid rgba(0,0,0,0.08)",
                                  paddingBottom: 6,
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 900 }}>
                                    {it.item_name}{" "}
                                    <span style={{ fontWeight: 700, opacity: 0.7 }}>({it.category})</span>
                                  </div>
                                  <div style={{ opacity: 0.85, fontSize: 13 }}>
                                    Qty: {it.quantity} • {moneyText(it.price)}
                                  </div>
                                </div>
                                <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{moneyText(it.total)}</div>
                              </div>
                            ))}
                          </div>
                        </td>

                        <td style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{moneyText(due)}</td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash {moneyText(o.gcash_amount)} / Cash {moneyText(o.cash_amount)}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(o)}
                              disabled={due <= 0}
                              title={due <= 0 ? "No amount due" : "Set GCash/Cash payment"}
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          {/* ✅ SAME PAID BADGE STYLE as Customer_Lists */}
                          <button
                            className={`receipt-btn pay-badge ${paid ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(o)}
                            disabled={togglingPaidKey === o.key}
                            title={paid ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {togglingPaidKey === o.key ? "Updating..." : paid ? "PAID" : "UNPAID"}
                          </button>

                          {remaining > 0 && (
                            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                              Remaining: <strong>{moneyText(remaining)}</strong>
                            </div>
                          )}
                        </td>

                        <td>
                          <div className="action-stack">
                            <button className="receipt-btn" onClick={() => setSelectedOrder(o)}>
                              View Receipt
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* PAYMENT MODAL */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">{paymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = round2(Math.max(0, paymentTarget.grand_total));
                  const gcIn = round2(Math.max(0, Number(gcashInput) || 0));
                  const adj = recalcPaymentsToDue(due, gcIn);

                  const totalPaid = round2(adj.gcash + adj.cash);
                  const remaining = round2(Math.max(0, due - totalPaid));

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Total Balance (Due)</span>
                        <span>{moneyText(due)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={gcashInput}
                          onChange={(e) => setGcashAndAutoCash(paymentTarget, e.currentTarget.value)}
                        />
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashInput}
                          onChange={(e) => setCashAndAutoGcash(paymentTarget, e.currentTarget.value)}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>{moneyText(totalPaid)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining</span>
                        <span>{moneyText(remaining)}</span>
                      </div>

                      {/* ✅ SAME modal actions layout as Customer_Lists */}
                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setPaymentTarget(null)}>
                          Cancel
                        </button>
                        <button className="receipt-btn" onClick={() => void savePayment()} disabled={savingPayment}>
                          {savingPayment ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* RECEIPT MODAL */}
          {selectedOrder && (
            <div className="receipt-overlay" onClick={() => setSelectedOrder(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">OFFICIAL RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Date</span>
                  <span>{new Date(selectedOrder.created_at).toLocaleString("en-PH")}</span>
                </div>

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{selectedOrder.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{selectedOrder.seat_number}</span>
                </div>

                <hr />

                {selectedOrder.items.map((it) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900 }}>
                        {it.item_name} <span style={{ fontWeight: 700, opacity: 0.7 }}>({it.category})</span>
                      </div>
                      <div style={{ opacity: 0.8, fontSize: 13 }}>
                        {it.quantity} × {moneyText(it.price)}
                      </div>
                    </div>
                    <div style={{ fontWeight: 1000, whiteSpace: "nowrap" }}>{moneyText(it.total)}</div>
                  </div>
                ))}

                <hr />

                {(() => {
                  const due = round2(Math.max(0, selectedOrder.grand_total));
                  const gcash = round2(Math.max(0, selectedOrder.gcash_amount));
                  const cash = round2(Math.max(0, selectedOrder.cash_amount));
                  const totalPaid = round2(gcash + cash);
                  const remaining = round2(Math.max(0, due - totalPaid));

                  // ✅ IMPORTANT: receipt follows manual is_paid
                  const paid = toBool(selectedOrder.is_paid);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Total</span>
                        <span>{moneyText(due)}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>GCash</span>
                        <span>{moneyText(gcash)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <span>{moneyText(cash)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>{moneyText(totalPaid)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining Balance</span>
                        <span>{moneyText(remaining)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{paid ? "PAID" : "UNPAID"}</span>
                      </div>

                      {paid && (
                        <div className="receipt-row">
                          <span>Paid at</span>
                          <span>{selectedOrder.paid_at ? new Date(selectedOrder.paid_at).toLocaleString("en-PH") : "-"}</span>
                        </div>
                      )}

                      <div className="receipt-total">
                        <span>TOTAL</span>
                        <span>{moneyText(due)}</span>
                      </div>
                    </>
                  );
                })()}

                <p className="receipt-footer">
                  Thank you for choosing <br />
                  <strong>Me Tyme Lounge</strong>
                </p>

                <button className="close-btn" onClick={() => setSelectedOrder(null)}>
                  Close
                </button>
              </div>
            </div>
          )}

          {!loading && groupedOrders.length === 0 && <IonText />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Customer_Add_ons;
