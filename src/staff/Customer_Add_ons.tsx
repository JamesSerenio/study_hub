// src/pages/Customer_Add_ons.tsx
// ✅ FIX: uses Asia/Manila day range (+08:00) for created_at filtering
// ✅ FIX: joins add_ons (name/category/size)
// ✅ CANCEL (requires description) via RPC cancel_add_on_order
// ✅ Payment modal: FREE INPUTS (NO LIMIT / NO FORCING to due)
// ✅ Payment SAVE uses RPC set_addon_payment (AUTO PAID/UNPAID in DB) — same as Admin
// ✅ Manual PAID toggle uses RPC set_addon_paid_status — same as Admin
// ✅ NEW: Search bar (same UI as customer list search bar)
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
  size: string | null;
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

  add_ons: AddOnInfo | null;
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
  size: string | null;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;
}

type OrderItem = {
  id: string; // customer_session_add_ons.id
  add_on_id: string;
  category: string;
  size: string | null;
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

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

const ms = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const moneyText = (n: number): string => `₱${round2(n).toFixed(2)}`;

const sizeText = (s: string | null | undefined): string => {
  const v = String(s ?? "").trim();
  return v.length > 0 ? v : "—";
};

// ✅ Manila day range from YYYY-MM-DD
const manilaDayRange = (yyyyMmDd: string): { startIso: string; endIso: string } => {
  const start = new Date(`${yyyyMmDd}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

const GROUP_WINDOW_MS = 10_000;

const samePersonSeat = (a: CustomerAddOnMerged, b: CustomerAddOnMerged): boolean =>
  norm(a.full_name) === norm(b.full_name) && norm(a.seat_number) === norm(b.seat_number);

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("en-PH");
};

/* ---------------- component ---------------- */

const Customer_Add_ons: React.FC = () => {
  const [records, setRecords] = useState<CustomerAddOnMerged[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // ✅ Search
  const [searchText, setSearchText] = useState<string>("");

  const [selectedOrder, setSelectedOrder] = useState<OrderGroup | null>(null);

  // ✅ Payment modal (FREE INPUTS, NO LIMIT)
  const [paymentTarget, setPaymentTarget] = useState<OrderGroup | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  const [togglingPaidKey, setTogglingPaidKey] = useState<string | null>(null);

  // ✅ CANCEL states
  const [cancelTarget, setCancelTarget] = useState<OrderGroup | null>(null);
  const [cancelDesc, setCancelDesc] = useState<string>("");
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);

  useEffect(() => {
    void fetchAddOns(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchAddOns(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const fetchAddOns = async (dateStr: string): Promise<void> => {
    setLoading(true);

    const { startIso, endIso } = manilaDayRange(dateStr);

    const q = supabase
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
        paid_at,
        add_ons (
          id,
          name,
          category,
          size
        )
      `
      )
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true });

    const { data, error } = await q.returns<CustomerSessionAddOnRow[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("FETCH ADD-ONS ERROR:", error);
      setRecords([]);
      setLoading(false);
      return;
    }

    const merged: CustomerAddOnMerged[] = (data ?? []).map((r) => {
      const a = r.add_ons;
      return {
        id: r.id,
        created_at: r.created_at,
        add_on_id: r.add_on_id,
        quantity: Number.isFinite(r.quantity) ? r.quantity : 0,
        price: toNumber(r.price),
        total: toNumber(r.total),
        full_name: r.full_name,
        seat_number: r.seat_number,

        item_name: a?.name ?? "-",
        category: a?.category ?? "-",
        size: a?.size ?? null,

        gcash_amount: round2(Math.max(0, toNumber(r.gcash_amount))),
        cash_amount: round2(Math.max(0, toNumber(r.cash_amount))),
        is_paid: toBool(r.is_paid),
        paid_at: r.paid_at ?? null,
      };
    });

    setRecords(merged);
    setLoading(false);
  };

  const groupedOrdersAll = useMemo<OrderGroup[]>(() => {
    if (records.length === 0) return [];

    const groups: OrderGroup[] = [];
    let current: OrderGroup | null = null;
    let lastRow: CustomerAddOnMerged | null = null;

    for (const row of records) {
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
          is_paid: false,
          paid_at: null,
        };

        groups.push(current);
      }

      if (!current) continue;

      current.items.push({
        id: row.id,
        add_on_id: row.add_on_id,
        category: row.category,
        size: row.size,
        item_name: row.item_name,
        quantity: Number(row.quantity) || 0,
        price: row.price,
        total: row.total,
      });

      current.grand_total = round2(current.grand_total + row.total);
      current.gcash_amount = round2(current.gcash_amount + row.gcash_amount);
      current.cash_amount = round2(current.cash_amount + row.cash_amount);

      current.is_paid = current.is_paid || row.is_paid;
      current.paid_at = current.paid_at ?? row.paid_at;

      lastRow = row;
    }

    return groups.sort((a, b) => ms(b.created_at) - ms(a.created_at));
  }, [records]);

  // ✅ Search filter (Full Name + Seat + Item name)
  const groupedOrders = useMemo<OrderGroup[]>(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return groupedOrdersAll;

    return groupedOrdersAll.filter((o) => {
      const name = String(o.full_name ?? "").toLowerCase();
      const seat = String(o.seat_number ?? "").toLowerCase();
      const items = o.items.some((it) => String(it.item_name ?? "").toLowerCase().includes(q));
      return name.includes(q) || seat.includes(q) || items;
    });
  }, [groupedOrdersAll, searchText]);

  /* ---------------- payment modal (FREE INPUT, RPC like Admin) ---------------- */

  const openPaymentModal = (o: OrderGroup): void => {
    setPaymentTarget(o);
    setGcashInput(String(round2(Math.max(0, o.gcash_amount))));
    setCashInput(String(round2(Math.max(0, o.cash_amount))));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    // ✅ FREE INPUTS: no forcing/limiting to due
    const g = round2(Math.max(0, toNumber(gcashInput)));
    const c = round2(Math.max(0, toNumber(cashInput)));

    const itemIds = paymentTarget.items.map((x) => x.id);
    if (itemIds.length === 0) return;

    try {
      setSavingPayment(true);

      // ✅ RPC updates gcash/cash AND auto sets is_paid/paid_at in DB
      const { error } = await supabase.rpc("set_addon_payment", {
        p_item_ids: itemIds,
        p_gcash: g,
        p_cash: c,
      });

      if (error) {
        alert(`Save payment error: ${error.message}`);
        return;
      }

      setPaymentTarget(null);
      await fetchAddOns(selectedDate);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  const togglePaid = async (o: OrderGroup): Promise<void> => {
    const itemIds = o.items.map((x) => x.id);
    if (itemIds.length === 0) return;

    try {
      setTogglingPaidKey(o.key);

      const nextPaid = !toBool(o.is_paid);

      const { error } = await supabase.rpc("set_addon_paid_status", {
        p_item_ids: itemIds,
        p_is_paid: nextPaid,
      });

      if (error) {
        alert(`Toggle paid error: ${error.message}`);
        return;
      }

      await fetchAddOns(selectedDate);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidKey(null);
    }
  };

  /* =========================================================
     ✅ CANCEL (requires description)
  ========================================================= */

  const openCancelModal = (o: OrderGroup): void => {
    setCancelTarget(o);
    setCancelDesc("");
  };

  const submitCancel = async (): Promise<void> => {
    if (!cancelTarget) return;

    const desc = cancelDesc.trim();
    if (!desc) {
      alert("Description is required before you can cancel.");
      return;
    }

    const itemIds = cancelTarget.items.map((x) => x.id);
    if (itemIds.length === 0) {
      alert("Nothing to cancel.");
      return;
    }

    try {
      setCancellingKey(cancelTarget.key);

      const { error } = await supabase.rpc("cancel_add_on_order", {
        p_item_ids: itemIds,
        p_description: desc,
      });

      if (error) {
        alert(`Cancel error: ${error.message}`);
        return;
      }

      setCancelTarget(null);
      setSelectedOrder(null);
      await fetchAddOns(selectedDate);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Cancel failed.");
    } finally {
      setCancellingKey(null);
    }
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Customer Add-Ons Records</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong> ({groupedOrders.length})
              </div>
            </div>

            <div className="customer-topbar-right">
              {/* ✅ SEARCH BAR */}
              <div className="customer-searchbar-inline">
                <div className="customer-searchbar-inner">
                  <span className="customer-search-icon" aria-hidden="true">
                    🔎
                  </span>

                  <input
                    className="customer-search-input"
                    type="text"
                    placeholder="Search name / seat / item..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.currentTarget.value)}
                  />

                  {searchText.trim() && (
                    <button className="customer-search-clear" onClick={() => setSearchText("")}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

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

              <div className="admin-tools-row">
                <button
                  className="receipt-btn"
                  onClick={() => void fetchAddOns(selectedDate)}
                  style={{ whiteSpace: "nowrap" }}
                  disabled={loading}
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>

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
                    const diff = round2(totalPaid - due);
                    const paid = toBool(o.is_paid);

                    const busyCancel = cancellingKey === o.key;

                    return (
                      <tr key={o.key}>
                        <td>{formatDateTime(o.created_at)}</td>
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
                                    <span style={{ fontWeight: 700, opacity: 0.7 }}>
                                      ({it.category}
                                      {String(it.size ?? "").trim() ? ` • ${sizeText(it.size)}` : ""})
                                    </span>
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

                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{moneyText(due)}</span>
                            <span className="cell-muted">
                              {diff >= 0 ? `Change: ${moneyText(Math.abs(diff))}` : `Remaining: ${moneyText(Math.abs(diff))}`}
                            </span>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash {moneyText(o.gcash_amount)} / Cash {moneyText(o.cash_amount)}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(o)}
                              disabled={due <= 0}
                              title={due <= 0 ? "No amount due" : "Set Cash & GCash freely (no limit)"}
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${paid ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(o)}
                            disabled={togglingPaidKey === o.key}
                            title={paid ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {togglingPaidKey === o.key ? "Updating..." : paid ? "PAID" : "UNPAID"}
                          </button>
                        </td>

                        <td>
                          <div className="action-stack">
                            <button className="receipt-btn" onClick={() => setSelectedOrder(o)}>
                              View Receipt
                            </button>

                            <button className="receipt-btn" disabled={busyCancel} onClick={() => openCancelModal(o)}>
                              {busyCancel ? "Cancelling..." : "Cancel"}
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

          {/* ✅ PAYMENT MODAL (FREE INPUTS, NO LIMIT) */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">{paymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = round2(Math.max(0, paymentTarget.grand_total));
                  const g = round2(Math.max(0, toNumber(gcashInput)));
                  const c = round2(Math.max(0, toNumber(cashInput)));
                  const totalPaid = round2(g + c);

                  const diff = round2(totalPaid - due);
                  const isPaidAuto = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Payment Due</span>
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
                          onChange={(e) => setGcashInput(e.currentTarget.value)}
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
                          onChange={(e) => setCashInput(e.currentTarget.value)}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>{moneyText(totalPaid)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>{moneyText(Math.abs(diff))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Auto Status</span>
                        <span className="receipt-status">{isPaidAuto ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setPaymentTarget(null)} disabled={savingPayment}>
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

          {/* ✅ CANCEL DESCRIPTION MODAL */}
          {cancelTarget && (
            <div className="receipt-overlay" onClick={() => (cancellingKey ? null : setCancelTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL ORDER</h3>
                <p className="receipt-subtitle">
                  {cancelTarget.full_name} • Seat {cancelTarget.seat_number}
                </p>

                <hr />

                <div style={{ fontWeight: 800, marginBottom: 8 }}>Required: Description / Reason</div>

                <textarea
                  value={cancelDesc}
                  onChange={(e) => setCancelDesc(e.currentTarget.value)}
                  placeholder="Example: Customer changed mind / wrong item / duplicate order..."
                  style={{
                    width: "100%",
                    minHeight: 110,
                    resize: "vertical",
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.15)",
                    outline: "none",
                    fontSize: 14,
                  }}
                  disabled={cancellingKey === cancelTarget.key}
                />

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                  ⚠️ Cancel will archive this order to the cancel table and reverse SOLD.
                </div>

                <div className="modal-actions" style={{ marginTop: 14 }}>
                  <button
                    className="receipt-btn"
                    onClick={() => setCancelTarget(null)}
                    disabled={cancellingKey === cancelTarget.key}
                  >
                    Close
                  </button>
                  <button
                    className="receipt-btn"
                    onClick={() => void submitCancel()}
                    disabled={cancellingKey === cancelTarget.key || cancelDesc.trim().length === 0}
                    title={cancelDesc.trim().length === 0 ? "Description required" : "Submit cancel"}
                  >
                    {cancellingKey === cancelTarget.key ? "Cancelling..." : "Submit Cancel"}
                  </button>
                </div>
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
                  <span>{formatDateTime(selectedOrder.created_at)}</span>
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
                        {it.item_name}{" "}
                        <span style={{ fontWeight: 700, opacity: 0.7 }}>
                          ({it.category}
                          {String(it.size ?? "").trim() ? ` • ${sizeText(it.size)}` : ""})
                        </span>
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
                  const diff = round2(totalPaid - due);
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
                        <span>{diff >= 0 ? "Change" : "Remaining Balance"}</span>
                        <span>{moneyText(Math.abs(diff))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{paid ? "PAID" : "UNPAID"}</span>
                      </div>

                      {paid && (
                        <div className="receipt-row">
                          <span>Paid at</span>
                          <span>{selectedOrder.paid_at ? formatDateTime(selectedOrder.paid_at) : "-"}</span>
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
