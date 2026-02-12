// src/pages/Customer_Consignment_Record.tsx
// ✅ Shows customer_session_consignment records
// ✅ Join with consignment for item info (name/image/size/category)
// ✅ View Receipt modal (same vibe as Admin_Customer_Add_ons receipt)
// ✅ Payment modal (Cash + GCash, FREE INPUTS, NO LIMIT) -> RPC set_consignment_payment
// ✅ Manual PAID toggle -> RPC set_consignment_paid_status
// ✅ VOID (required reason) -> returns stock by RPC void_customer_consignment
// ✅ STRICT TS: NO any
// ✅ Same "customer-*" + "receipt-btn" vibe

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

type NumericLike = number | string;

type ConsignmentInfo = {
  item_name: string;
  size: string | null;
  image_url: string | null;
  category: string | null;
};

type CustomerConsignmentRow = {
  id: string;
  created_at: string | null;

  consignment_id: string;
  quantity: number;
  price: NumericLike;
  total: NumericLike | null;

  full_name: string;
  seat_number: string;

  paid_at: string | null;
  gcash_amount: NumericLike;
  cash_amount: NumericLike;
  is_paid: boolean | number | string | null;

  // ✅ if you don't have these cols yet, keep them in types; your SELECT may fail.
  // If your table DOES NOT have these columns, remove them from select + type.
  voided: boolean | number | string | null;
  voided_at: string | null;
  void_note: string | null;

  consignment: ConsignmentInfo | null;
};

type ReceiptItem = {
  id: string;
  item_name: string;
  category: string;
  size: string | null;
  quantity: number;
  price: number;
  total: number;
  image_url: string | null;
};

type ReceiptGroup = {
  id: string; // row id
  created_at: string | null;
  full_name: string;
  seat_number: string;

  items: ReceiptItem[];
  grand_total: number;

  gcash_amount: number;
  cash_amount: number;

  is_paid: boolean;
  paid_at: string | null;

  is_voided: boolean;
  voided_at: string | null;
  void_note: string | null;
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
const moneyText = (n: number): string => `₱${round2(n).toFixed(2)}`;

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
const show = (s: string | null | undefined, fallback = "-"): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : fallback;
};

const formatPHDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
};

const sizeText = (s: string | null | undefined): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : "—";
};

/* ---------------- component ---------------- */

const Customer_Consignment_Record: React.FC = () => {
  const [rows, setRows] = useState<CustomerConsignmentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [searchText, setSearchText] = useState<string>("");

  // receipt modal
  const [selectedOrder, setSelectedOrder] = useState<ReceiptGroup | null>(null);

  // payment modal
  const [paymentTarget, setPaymentTarget] = useState<ReceiptGroup | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // paid toggle busy
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  // VOID modal
  const [voidTarget, setVoidTarget] = useState<CustomerConsignmentRow | null>(null);
  const [voidReason, setVoidReason] = useState<string>("");
  const [voiding, setVoiding] = useState<boolean>(false);

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_session_consignment")
      .select(
        `
        id,
        created_at,
        consignment_id,
        quantity,
        price,
        total,
        full_name,
        seat_number,
        paid_at,
        gcash_amount,
        cash_amount,
        is_paid,
        voided,
        voided_at,
        void_note,
        consignment:consignment_id (
          item_name,
          size,
          image_url,
          category
        )
      `
      )
      .order("created_at", { ascending: false })
      .returns<CustomerConsignmentRow[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error("FETCH customer_session_consignment ERROR:", error);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(data ?? []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = norm(searchText);
    if (!q) return rows;

    return rows.filter((r) => {
      const fn = norm(r.full_name);
      const seat = norm(r.seat_number);
      const item = norm(r.consignment?.item_name ?? "");
      const cat = norm(r.consignment?.category ?? "");
      return fn.includes(q) || seat.includes(q) || item.includes(q) || cat.includes(q);
    });
  }, [rows, searchText]);

  const totals = useMemo(() => {
    let totalAmount = 0;
    let totalCash = 0;
    let totalGcash = 0;

    for (const r of filtered) {
      const isVoided = toBool(r.voided);
      if (isVoided) continue;
      totalAmount += round2(toNumber(r.total));
      totalCash += round2(toNumber(r.cash_amount));
      totalGcash += round2(toNumber(r.gcash_amount));
    }

    return {
      totalAmount: round2(totalAmount),
      totalCash: round2(totalCash),
      totalGcash: round2(totalGcash),
    };
  }, [filtered]);

  const makeReceiptGroup = (r: CustomerConsignmentRow): ReceiptGroup => {
    const qty = Number(r.quantity ?? 0) || 0;
    const price = round2(toNumber(r.price));
    const total = round2(toNumber(r.total));

    const itemName = show(r.consignment?.item_name);
    const cat = show(r.consignment?.category);
    const img = r.consignment?.image_url ?? null;

    const gcash = round2(Math.max(0, toNumber(r.gcash_amount)));
    const cash = round2(Math.max(0, toNumber(r.cash_amount)));
    const paid = toBool(r.is_paid);
    const isVoided = toBool(r.voided);

    const group: ReceiptGroup = {
      id: r.id,
      created_at: r.created_at,
      full_name: r.full_name,
      seat_number: r.seat_number,
      items: [
        {
          id: r.id,
          item_name: itemName,
          category: cat,
          size: r.consignment?.size ?? null,
          quantity: qty,
          price,
          total,
          image_url: img,
        },
      ],
      grand_total: total,
      gcash_amount: gcash,
      cash_amount: cash,
      is_paid: paid,
      paid_at: r.paid_at ?? null,
      is_voided: isVoided,
      voided_at: r.voided_at ?? null,
      void_note: r.void_note ?? null,
    };

    return group;
  };

  /* ---------------- actions (receipt/payment/paid/void) ---------------- */

  const openReceipt = (r: CustomerConsignmentRow): void => {
    setSelectedOrder(makeReceiptGroup(r));
  };

  const openPaymentModal = (r: CustomerConsignmentRow): void => {
    const g = makeReceiptGroup(r);
    if (g.is_voided) {
      alert("Cannot set payment for VOIDED record.");
      return;
    }
    setPaymentTarget(g);
    setGcashInput(String(round2(Math.max(0, g.gcash_amount))));
    setCashInput(String(round2(Math.max(0, g.cash_amount))));
  };

  // ✅ RPC needed on your DB:
  // set_consignment_payment(p_row_id uuid, p_gcash numeric, p_cash numeric)
  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const g = round2(Math.max(0, toNumber(gcashInput)));
    const c = round2(Math.max(0, toNumber(cashInput)));

    try {
      setSavingPayment(true);

      const { error } = await supabase.rpc("set_consignment_payment", {
        p_row_id: paymentTarget.id,
        p_gcash: g,
        p_cash: c,
      });

      if (error) {
        alert(`Save payment error: ${error.message}`);
        return;
      }

      setPaymentTarget(null);
      await fetchAll();
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  // ✅ RPC needed on your DB:
  // set_consignment_paid_status(p_row_id uuid, p_is_paid boolean)
  const togglePaid = async (r: CustomerConsignmentRow): Promise<void> => {
    if (toBool(r.voided)) {
      alert("Cannot change paid status for VOIDED record.");
      return;
    }

    try {
      setTogglingPaidId(r.id);

      const nextPaid = !toBool(r.is_paid);

      const { error } = await supabase.rpc("set_consignment_paid_status", {
        p_row_id: r.id,
        p_is_paid: nextPaid,
      });

      if (error) {
        alert(`Toggle paid error: ${error.message}`);
        return;
      }

      await fetchAll();
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  const openVoid = (r: CustomerConsignmentRow): void => {
    setVoidTarget(r);
    setVoidReason("");
  };

  const submitVoid = async (): Promise<void> => {
    if (!voidTarget) return;

    const reason = voidReason.trim();
    if (!reason) {
      alert("Void reason is required.");
      return;
    }

    if (toBool(voidTarget.voided)) {
      alert("Already voided.");
      return;
    }

    try {
      setVoiding(true);

      const { error } = await supabase.rpc("void_customer_consignment", {
        p_row_id: voidTarget.id,
        p_reason: reason,
      });

      if (error) {
        alert(`Void failed: ${error.message}`);
        return;
      }

      setVoidTarget(null);
      setVoidReason("");
      setSelectedOrder(null);
      setPaymentTarget(null);
      await fetchAll();
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Void failed.");
    } finally {
      setVoiding(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          {/* TOPBAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Customer Consignment Records</h2>
              <div className="customer-subtext">
                Rows: <strong>{filtered.length}</strong> • Total: <strong>{moneyText(totals.totalAmount)}</strong> • Cash:{" "}
                <strong>{moneyText(totals.totalCash)}</strong> • GCash: <strong>{moneyText(totals.totalGcash)}</strong>
              </div>
            </div>

            <div className="customer-topbar-right">
              {/* SEARCH */}
              <div className="customer-searchbar-inline">
                <div className="customer-searchbar-inner">
                  <span className="customer-search-icon" aria-hidden="true">
                    🔎
                  </span>

                  <input
                    className="customer-search-input"
                    type="text"
                    placeholder="Search fullname / seat / item / category..."
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

              <div className="admin-tools-row">
                <button className="receipt-btn" onClick={() => void fetchAll()} disabled={loading}>
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="customer-note">No consignment records found.</p>
          ) : (
            <div className="customer-table-wrap">
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Date/Time (PH)</th>
                    <th>Full Name</th>
                    <th>Seat</th>
                    <th>Size</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Paid?</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((r) => {
                    const qty = Number(r.quantity ?? 0) || 0;
                    const price = round2(toNumber(r.price));
                    const total = round2(toNumber(r.total));

                    const cash = round2(toNumber(r.cash_amount));
                    const gcash = round2(toNumber(r.gcash_amount));

                    const itemName = show(r.consignment?.item_name);
                    const cat = show(r.consignment?.category);
                    const img = r.consignment?.image_url ?? null;

                    const isVoided = toBool(r.voided);
                    const isPaid = toBool(r.is_paid);
                    const busyPaid = togglingPaidId === r.id;

                    return (
                      <tr key={r.id} style={isVoided ? { opacity: 0.65 } : undefined}>
                        <td style={{ width: 86 }}>
                          {img ? (
                            <img
                              src={img}
                              alt={itemName}
                              style={{
                                width: 64,
                                height: 64,
                                objectFit: "cover",
                                borderRadius: 12,
                                border: "1px solid rgba(0,0,0,0.12)",
                              }}
                              loading="lazy"
                            />
                          ) : (
                            <div
                              style={{
                                width: 64,
                                height: 64,
                                borderRadius: 12,
                                border: "1px dashed rgba(0,0,0,0.25)",
                                display: "grid",
                                placeItems: "center",
                                fontSize: 12,
                                opacity: 0.75,
                              }}
                            >
                              No Image
                            </div>
                          )}
                        </td>

                        <td style={{ fontWeight: 900 }}>{itemName}</td>
                        <td style={{ fontWeight: 800 }}>{cat}</td>
                        <td>{formatPHDateTime(r.created_at)}</td>
                        <td style={{ fontWeight: 900 }}>{show(r.full_name)}</td>
                        <td style={{ fontWeight: 900 }}>{show(r.seat_number)}</td>
                        <td>{sizeText(r.consignment?.size)}</td>

                        <td style={{ fontWeight: 900 }}>{qty}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{moneyText(price)}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(total)}</td>

                        {/* ✅ PAYMENT like Add-ons */}
                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash {moneyText(gcash)} / Cash {moneyText(cash)}
                            </span>

                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(r)}
                              disabled={isVoided || total <= 0}
                              title={isVoided ? "Voided" : "Set Cash & GCash freely (no limit)"}
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        {/* ✅ PAID badge toggle like Add-ons */}
                        <td>
                          <button
                            className={`receipt-btn pay-badge ${isPaid ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(r)}
                            disabled={busyPaid || isVoided}
                            title={isVoided ? "Voided" : isPaid ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {busyPaid ? "Updating..." : isPaid ? "PAID" : "UNPAID"}
                          </button>
                        </td>

                        <td>
                          <div className="action-stack">
                            <button className="receipt-btn" onClick={() => openReceipt(r)}>
                              View Receipt
                            </button>

                            <button
                              className="receipt-btn"
                              onClick={() => openVoid(r)}
                              disabled={isVoided}
                              title={isVoided ? "Already voided" : "Void (returns stock)"}
                            >
                              Void
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

          {/* ✅ PAYMENT MODAL (NO LIMIT) */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => (savingPayment ? null : setPaymentTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">
                  {paymentTarget.full_name} • Seat {paymentTarget.seat_number}
                </p>

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
                          disabled={savingPayment}
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
                          disabled={savingPayment}
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

          {/* ✅ RECEIPT MODAL (same vibe) */}
          {selectedOrder && (
            <div className="receipt-overlay" onClick={() => setSelectedOrder(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">OFFICIAL RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Date</span>
                  <span>{formatPHDateTime(selectedOrder.created_at)}</span>
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

                <div className="items-receipt">
                  {selectedOrder.items.map((it) => (
                    <div className="receipt-item-row" key={it.id}>
                      <div className="receipt-item-left">
                        <div className="receipt-item-title">
                          {it.item_name}{" "}
                          <span className="item-cat">
                            ({it.category}
                            {String(it.size ?? "").trim() ? ` • ${sizeText(it.size)}` : ""})
                          </span>
                        </div>
                        <div className="receipt-item-sub">
                          {it.quantity} × {moneyText(it.price)}
                        </div>
                      </div>
                      <div className="receipt-item-total">{moneyText(it.total)}</div>
                    </div>
                  ))}
                </div>

                <hr />

                {(() => {
                  const due = round2(Math.max(0, selectedOrder.grand_total));
                  const gcash = round2(Math.max(0, selectedOrder.gcash_amount));
                  const cash = round2(Math.max(0, selectedOrder.cash_amount));
                  const totalPaid = round2(gcash + cash);
                  const diff = round2(totalPaid - due);

                  const paid = toBool(selectedOrder.is_paid);
                  const isVoided = selectedOrder.is_voided;

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
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>{moneyText(Math.abs(diff))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{isVoided ? "VOIDED" : paid ? "PAID" : "UNPAID"}</span>
                      </div>

                      {paid && !isVoided && (
                        <div className="receipt-row">
                          <span>Paid at</span>
                          <span>{selectedOrder.paid_at ? formatPHDateTime(selectedOrder.paid_at) : "-"}</span>
                        </div>
                      )}

                      {isVoided && (
                        <>
                          <div className="receipt-row">
                            <span>Voided at</span>
                            <span>{selectedOrder.voided_at ? formatPHDateTime(selectedOrder.voided_at) : "-"}</span>
                          </div>
                          <div className="receipt-row">
                            <span>Void note</span>
                            <span style={{ textAlign: "right", maxWidth: 220 }}>{show(selectedOrder.void_note, "-")}</span>
                          </div>
                        </>
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

          {/* ✅ VOID MODAL */}
          {voidTarget && (
            <div className="receipt-overlay" onClick={() => (voiding ? null : setVoidTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">VOID CONSIGNMENT</h3>
                <p className="receipt-subtitle">
                  {show(voidTarget.consignment?.item_name)} • Qty: <b>{voidTarget.quantity}</b> • Seat:{" "}
                  <b>{show(voidTarget.seat_number)}</b>
                </p>

                <hr />

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    Reason <span style={{ color: "crimson" }}>*</span>
                  </div>
                  <textarea
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.currentTarget.value)}
                    placeholder="Example: wrong item / mistaken quantity / cancelled..."
                    style={{
                      width: "100%",
                      minHeight: 90,
                      resize: "vertical",
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.15)",
                      outline: "none",
                      fontSize: 14,
                    }}
                    disabled={voiding}
                  />
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                  Note: Voiding will <b>return stock</b> by reducing <b>consignment.sold</b>.
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setVoidTarget(null)} disabled={voiding}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void submitVoid()} disabled={voiding}>
                    {voiding ? "Voiding..." : "Confirm Void"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!loading && filtered.length === 0 && <IonText />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Customer_Consignment_Record;
