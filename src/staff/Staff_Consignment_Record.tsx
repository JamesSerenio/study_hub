// src/pages/Staff_Consignment_Record.tsx
// ✅ NO DATE FILTER (shows ALL records)
// ✅ Date/Time shown in PH
// ✅ REMOVED Transactions column
// ✅ Overall Sales shown is NET (gross - 15%)
// ✅ REMOVED “Oversale (15%)” column everywhere
// ✅ Remaining = (15% of gross overall) - cashouts (still works for cashout)
// ✅ Cash Out modal (per Full Name) + cashout history (ALL TIME for that name)
// ✅ SAME classnames as Customer_Add_ons.tsx (customer-* / receipt-btn)
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type NumericLike = number | string;

interface ConsignmentRow {
  id: string;
  created_at: string;

  full_name: string;
  item_name: string;
  size: string | null;
  image_url: string | null;

  price: NumericLike;
  restocked: number | null;
  sold: number | null;

  expected_sales: NumericLike | null; // should already be net (85%) in DB
  overall_sales: NumericLike | null; // gross in DB
  stocks: number | null; // generated
}

interface CashOutRow {
  id: string;
  created_at: string;
  full_name: string;
  cashout_amount: NumericLike;
  note: string | null;
}

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

const formatPHDateTime = (iso: string): string => {
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

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
const sizeText = (s: string | null | undefined): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : "—";
};

// money rules
const grossToNet = (gross: number): number => round2(gross * 0.85); // overall - 15%
const grossOversale = (gross: number): number => round2(gross * 0.15); // used for remaining/cashout

type PersonAgg = {
  full_name: string;

  total_restock: number;
  total_sold: number;

  expected_total: number; // sum expected_sales (85%)
  gross_total: number; // sum overall_sales (gross)
  net_total: number; // gross_total * 0.85 (shown as Overall Sales)

  cashout_total: number; // from cashouts
  remaining: number; // (gross_total*0.15) - cashout_total
};

const Staff_Consignment_Record: React.FC = () => {
  const [salesRows, setSalesRows] = useState<ConsignmentRow[]>([]);
  const [cashouts, setCashouts] = useState<CashOutRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [searchText, setSearchText] = useState<string>("");

  // cashout modal
  const [cashoutTargetName, setCashoutTargetName] = useState<string | null>(null);
  const [cashoutAmount, setCashoutAmount] = useState<string>("");
  const [cashoutNote, setCashoutNote] = useState<string>("");
  const [savingCashout, setSavingCashout] = useState<boolean>(false);

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async (): Promise<void> => {
    setLoading(true);

    // ✅ ALL consignment rows (no date filter)
    const { data: sales, error: sErr } = await supabase
      .from("consignment")
      .select(
        `
        id,
        created_at,
        full_name,
        item_name,
        size,
        image_url,
        price,
        restocked,
        sold,
        expected_sales,
        overall_sales,
        stocks
      `
      )
      .order("created_at", { ascending: false })
      .returns<ConsignmentRow[]>();

    if (sErr) {
      // eslint-disable-next-line no-console
      console.error("FETCH CONSIGNMENT ERROR:", sErr);
      setSalesRows([]);
      setCashouts([]);
      setLoading(false);
      return;
    }

    // ✅ ALL cashouts (no date filter)
    const { data: outs, error: cErr } = await supabase
      .from("consignment_cash_outs")
      .select("id, created_at, full_name, cashout_amount, note")
      .order("created_at", { ascending: false })
      .returns<CashOutRow[]>();

    if (cErr) {
      // eslint-disable-next-line no-console
      console.error("FETCH CASH OUTS ERROR:", cErr);
      setSalesRows(sales ?? []);
      setCashouts([]);
      setLoading(false);
      return;
    }

    setSalesRows(sales ?? []);
    setCashouts(outs ?? []);
    setLoading(false);
  };

  /* ---------------- build grouped summary ---------------- */

  const perNameAggAll = useMemo<PersonAgg[]>(() => {
    const map = new Map<string, PersonAgg>();

    const getOrCreate = (fullNameRaw: string): PersonAgg => {
      const key = norm(fullNameRaw);
      const found = map.get(key);
      if (found) return found;

      const fresh: PersonAgg = {
        full_name: (fullNameRaw ?? "").trim() || "-",
        total_restock: 0,
        total_sold: 0,
        expected_total: 0,
        gross_total: 0,
        net_total: 0,
        cashout_total: 0,
        remaining: 0,
      };

      map.set(key, fresh);
      return fresh;
    };

    for (const r of salesRows) {
      const a = getOrCreate(r.full_name);

      const rest = Number(r.restocked ?? 0) || 0;
      const sold = Number(r.sold ?? 0) || 0;

      a.total_restock += rest;
      a.total_sold += sold;

      const expected = round2(toNumber(r.expected_sales));
      const gross = round2(toNumber(r.overall_sales));

      a.expected_total = round2(a.expected_total + expected);
      a.gross_total = round2(a.gross_total + gross);
    }

    for (const a of map.values()) {
      a.net_total = grossToNet(a.gross_total);
    }

    for (const c of cashouts) {
      const a = getOrCreate(c.full_name);
      a.cashout_total = round2(a.cashout_total + round2(toNumber(c.cashout_amount)));
    }

    for (const a of map.values()) {
      const pool = grossOversale(a.gross_total);
      a.remaining = round2(Math.max(0, pool - a.cashout_total));
    }

    return Array.from(map.values()).sort((x, y) => norm(x.full_name).localeCompare(norm(y.full_name)));
  }, [salesRows, cashouts]);

  const perNameAgg = useMemo<PersonAgg[]>(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return perNameAggAll;
    return perNameAggAll.filter((p) => norm(p.full_name).includes(q));
  }, [perNameAggAll, searchText]);

  const filteredRows = useMemo<ConsignmentRow[]>(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return salesRows;

    return salesRows.filter((r) => {
      const f = norm(r.full_name);
      const it = norm(r.item_name);
      const sz = norm(r.size);
      return f.includes(q) || it.includes(q) || sz.includes(q);
    });
  }, [salesRows, searchText]);

  const rowsCount = filteredRows.length;

  /* ---------------- cashout ---------------- */

  const openCashout = (fullName: string): void => {
    setCashoutTargetName(fullName);
    setCashoutAmount("");
    setCashoutNote("");
  };

  // ✅ history ALL TIME for this name
  const cashoutHistoryForTarget = useMemo(() => {
    if (!cashoutTargetName) return [];
    const k = norm(cashoutTargetName);
    return cashouts.filter((c) => norm(c.full_name) === k);
  }, [cashoutTargetName, cashouts]);

  const submitCashout = async (): Promise<void> => {
    if (!cashoutTargetName) return;

    const amt = round2(Math.max(0, Number(cashoutAmount) || 0));
    if (amt <= 0) {
      alert("Cashout amount must be > 0");
      return;
    }

    const target = perNameAggAll.find((p) => norm(p.full_name) === norm(cashoutTargetName));
    const remaining = round2(target?.remaining ?? 0);

    if (amt > remaining) {
      alert(`Insufficient remaining. Remaining: ${moneyText(remaining)}`);
      return;
    }

    try {
      setSavingCashout(true);

      const { error } = await supabase.rpc("cashout_consignment_oversale", {
        p_cashout_amount: amt,
        p_full_name: cashoutTargetName,
        p_note: cashoutNote.trim() || null,
      });

      if (error) {
        alert(`Cash out error: ${error.message}`);
        return;
      }

      setCashoutTargetName(null);
      await fetchAll();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Cash out failed.");
    } finally {
      setSavingCashout(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          {/* TOPBAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Consignment Records</h2>
              <div className="customer-subtext">
                Showing: <strong>ALL</strong> • Rows: <strong>{rowsCount}</strong> • Names:{" "}
                <strong>{perNameAgg.length}</strong>
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
                    placeholder="Search fullname / item / size..."
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
          ) : perNameAgg.length === 0 ? (
            <p className="customer-note">No consignment data found.</p>
          ) : (
            <>
              {/* ✅ TOP SUMMARY TABLE */}
              <div className="customer-table-wrap" style={{ marginBottom: 14 }}>
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>Full Name</th>
                      <th>Total Restock</th>
                      <th>Total Sold</th>
                      <th>Expected Sales</th>
                      <th>Overall Sales</th>
                      <th>Cash Outs</th>
                      <th>Remaining</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {perNameAgg.map((p) => (
                      <tr key={norm(p.full_name)}>
                        <td style={{ fontWeight: 1000 }}>{p.full_name}</td>
                        <td style={{ fontWeight: 900 }}>{p.total_restock}</td>
                        <td style={{ fontWeight: 900 }}>{p.total_sold}</td>

                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.expected_total)}</td>

                        {/* ✅ Overall Sales is NET now (already -15%) */}
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.net_total)}</td>

                        <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{moneyText(p.cashout_total)}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1100 }}>{moneyText(p.remaining)}</td>

                        <td>
                          <div className="action-stack">
                            <button
                              className="receipt-btn"
                              onClick={() => openCashout(p.full_name)}
                              disabled={p.remaining <= 0}
                              title={p.remaining <= 0 ? "No remaining" : "Cash out"}
                            >
                              Cash Out
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ✅ DETAILS TABLE */}
              <div className="customer-table-wrap">
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>Item Name</th>
                      <th>Date/Time (PH)</th>
                      <th>Full Name</th>
                      <th>Size</th>
                      <th>Price</th>
                      <th>Restock</th>
                      <th>Stock</th>
                      <th>Sold</th>
                      <th>Expected Sales</th>
                      <th>Overall Sales</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRows.map((r) => {
                      const price = round2(toNumber(r.price));
                      const rest = Number(r.restocked ?? 0) || 0;
                      const sold = Number(r.sold ?? 0) || 0;
                      const stocks = Number(r.stocks ?? 0) || 0;

                      const expected = round2(toNumber(r.expected_sales));
                      const gross = round2(toNumber(r.overall_sales));
                      const netOverall = grossToNet(gross);

                      return (
                        <tr key={r.id}>
                          <td style={{ width: 86 }}>
                            {r.image_url ? (
                              <img
                                src={r.image_url}
                                alt={r.item_name}
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

                          <td style={{ fontWeight: 900 }}>{r.item_name || "-"}</td>
                          <td>{formatPHDateTime(r.created_at)}</td>
                          <td style={{ fontWeight: 900 }}>{r.full_name || "-"}</td>
                          <td>{sizeText(r.size)}</td>

                          <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{moneyText(price)}</td>
                          <td style={{ fontWeight: 900 }}>{rest}</td>
                          <td style={{ fontWeight: 900 }}>{stocks}</td>
                          <td style={{ fontWeight: 900 }}>{sold}</td>

                          <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(expected)}</td>
                          <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(netOverall)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* CASH OUT MODAL */}
          {cashoutTargetName && (
            <div className="receipt-overlay" onClick={() => (savingCashout ? null : setCashoutTargetName(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CASH OUT</h3>
                <p className="receipt-subtitle">{cashoutTargetName}</p>

                <hr />

                {(() => {
                  const p = perNameAggAll.find((x) => norm(x.full_name) === norm(cashoutTargetName));

                  const gross = round2(p?.gross_total ?? 0);
                  const net = grossToNet(gross);
                  const pool = grossOversale(gross);

                  const remaining = round2(p?.remaining ?? 0);
                  const cashout = round2(p?.cashout_total ?? 0);
                  const expected = round2(p?.expected_total ?? 0);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Expected Total</span>
                        <span>{moneyText(expected)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Overall Sales</span>
                        <span>{moneyText(net)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash Outs</span>
                        <span>{moneyText(cashout)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining</span>
                        <span style={{ fontWeight: 1000 }}>{moneyText(remaining)}</span>
                      </div>

                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                        Note: Remaining comes from MeTyme pool (15% of gross = {moneyText(pool)}).
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Cashout Amount</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashoutAmount}
                          onChange={(e) => setCashoutAmount(e.currentTarget.value)}
                          placeholder="0.00"
                          disabled={savingCashout}
                        />
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>Note (optional)</div>
                        <textarea
                          value={cashoutNote}
                          onChange={(e) => setCashoutNote(e.currentTarget.value)}
                          placeholder="Example: payout / release / partial cashout..."
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
                          disabled={savingCashout}
                        />
                      </div>

                      <div style={{ marginTop: 14, fontWeight: 900 }}>Cash Out History (all time)</div>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {cashoutHistoryForTarget.length === 0 ? (
                          <div style={{ opacity: 0.8, fontSize: 13 }}>No cash outs yet.</div>
                        ) : (
                          cashoutHistoryForTarget.map((h) => (
                            <div
                              key={h.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 12,
                                padding: 10,
                                border: "1px solid rgba(0,0,0,0.10)",
                                borderRadius: 12,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 900 }}>{formatPHDateTime(h.created_at)}</div>
                                {h.note ? <div style={{ fontSize: 12, opacity: 0.8 }}>{h.note}</div> : null}
                              </div>
                              <div style={{ fontWeight: 1100, whiteSpace: "nowrap" }}>
                                {moneyText(round2(toNumber(h.cashout_amount)))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="modal-actions" style={{ marginTop: 16 }}>
                        <button className="receipt-btn" onClick={() => setCashoutTargetName(null)} disabled={savingCashout}>
                          Close
                        </button>
                        <button className="receipt-btn" onClick={() => void submitCashout()} disabled={savingCashout}>
                          {savingCashout ? "Saving..." : "Cash Out"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {!loading && perNameAgg.length === 0 && <IonText />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Staff_Consignment_Record;
