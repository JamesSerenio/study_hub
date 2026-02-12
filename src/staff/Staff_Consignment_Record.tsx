// src/pages/Staff_Consignment_Record.tsx
// ✅ NO DATE FILTER (shows ALL records)
// ✅ Date/Time shown in PH
// ✅ REMOVED Transactions column
// ✅ Overall Sales shown is NET (gross - 15%)
// ✅ REMOVED “Oversale (15%)” column everywhere
// ✅ Remaining = NET Overall Sales - Cashouts   ✅ FIXED
// ✅ Cash Out modal (per Full Name) + cashout history (ALL TIME)
// ✅ SAME classnames as Customer_Add_ons.tsx (customer-* / receipt-btn)
// ✅ NEW: Category column (from consignment.category)
// ✅ NEW: Grouping can be by CATEGORY (toggle)
// ✅ STRICT TS: NO any

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type NumericLike = number | string;
type GroupBy = "full_name" | "category";

interface ConsignmentRow {
  id: string;
  created_at: string;

  full_name: string;
  category: string | null;

  item_name: string;
  size: string | null;
  image_url: string | null;

  price: NumericLike;
  restocked: number | null;
  sold: number | null;

  expected_sales: NumericLike | null; // net(85%) in DB (restocked*price*0.85)
  overall_sales: NumericLike | null; // gross in DB (sold*price)
  stocks: number | null;
}

interface CashOutRow {
  id: string;
  created_at: string;
  full_name: string;
  category: string | null; // if column exists; otherwise null
  cashout_amount: NumericLike;
  note: string | null;
}

interface CashOutRowNoCategory {
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

const show = (s: string | null | undefined, fallback = "-"): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : fallback;
};

const sizeText = (s: string | null | undefined): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : "—";
};

// money rules
const grossToNet = (gross: number): number => round2(gross * 0.85);

type PersonAgg = {
  key: string;
  label: string;

  total_restock: number;
  total_sold: number;

  expected_total: number;
  gross_total: number;
  net_total: number;

  cashout_total: number;
  remaining: number; // ✅ now based on net_total
};

const Staff_Consignment_Record: React.FC = () => {
  const [salesRows, setSalesRows] = useState<ConsignmentRow[]>([]);
  const [cashouts, setCashouts] = useState<CashOutRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [searchText, setSearchText] = useState<string>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("full_name");

  // cashout modal
  const [cashoutTargetKey, setCashoutTargetKey] = useState<string | null>(null);
  const [cashoutTargetLabel, setCashoutTargetLabel] = useState<string>("");
  const [cashoutAmount, setCashoutAmount] = useState<string>("");
  const [cashoutNote, setCashoutNote] = useState<string>("");
  const [savingCashout, setSavingCashout] = useState<boolean>(false);

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async (): Promise<void> => {
    setLoading(true);

    const { data: sales, error: sErr } = await supabase
      .from("consignment")
      .select(
        `
        id,
        created_at,
        full_name,
        category,
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

    // cashouts: try with category, fallback without
    const withCat = await supabase
      .from("consignment_cash_outs")
      .select("id, created_at, full_name, category, cashout_amount, note")
      .order("created_at", { ascending: false })
      .returns<CashOutRow[]>();

    if (withCat.error) {
      const noCat = await supabase
        .from("consignment_cash_outs")
        .select("id, created_at, full_name, cashout_amount, note")
        .order("created_at", { ascending: false })
        .returns<CashOutRowNoCategory[]>();

      if (noCat.error) {
        // eslint-disable-next-line no-console
        console.error("FETCH CASH OUTS ERROR:", noCat.error);
        setSalesRows(sales ?? []);
        setCashouts([]);
        setLoading(false);
        return;
      }

      const mapped: CashOutRow[] = (noCat.data ?? []).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        full_name: r.full_name,
        category: null,
        cashout_amount: r.cashout_amount,
        note: r.note,
      }));

      setSalesRows(sales ?? []);
      setCashouts(mapped);
      setLoading(false);
      return;
    }

    setSalesRows(sales ?? []);
    setCashouts(withCat.data ?? []);
    setLoading(false);
  };

  /* ---------------- build grouped summary ---------------- */

  const perKeyAggAll = useMemo<PersonAgg[]>(() => {
    const map = new Map<string, PersonAgg>();

    const getKeyAndLabel = (r: { full_name: string; category: string | null }): { key: string; label: string } => {
      if (groupBy === "category") {
        const label = show(r.category, "-");
        return { key: norm(label), label };
      }
      const label = show(r.full_name, "-");
      return { key: norm(label), label };
    };

    const getOrCreate = (key: string, label: string): PersonAgg => {
      const found = map.get(key);
      if (found) return found;

      const fresh: PersonAgg = {
        key,
        label,
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

    // sales aggregation
    for (const r of salesRows) {
      const { key, label } = getKeyAndLabel(r);
      const a = getOrCreate(key, label);

      const rest = Number(r.restocked ?? 0) || 0;
      const sold = Number(r.sold ?? 0) || 0;

      a.total_restock += rest;
      a.total_sold += sold;

      const expected = round2(toNumber(r.expected_sales));
      const gross = round2(toNumber(r.overall_sales));

      a.expected_total = round2(a.expected_total + expected);
      a.gross_total = round2(a.gross_total + gross);
    }

    // compute net totals
    for (const a of map.values()) a.net_total = grossToNet(a.gross_total);

    // cashout aggregation
    for (const c of cashouts) {
      const label = groupBy === "category" ? show(c.category, "-") : show(c.full_name, "-");
      const key = norm(label);
      const a = getOrCreate(key, label);
      a.cashout_total = round2(a.cashout_total + round2(toNumber(c.cashout_amount)));
    }

    // ✅ FIXED REMAINING: NET - CASHOUTS
    for (const a of map.values()) {
      a.remaining = round2(Math.max(0, a.net_total - a.cashout_total));
    }

    return Array.from(map.values()).sort((x, y) => norm(x.label).localeCompare(norm(y.label)));
  }, [salesRows, cashouts, groupBy]);

  const perKeyAgg = useMemo<PersonAgg[]>(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return perKeyAggAll;
    return perKeyAggAll.filter((p) => norm(p.label).includes(q));
  }, [perKeyAggAll, searchText]);

  const filteredRows = useMemo<ConsignmentRow[]>(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return salesRows;

    return salesRows.filter((r) => {
      const f = norm(r.full_name);
      const cat = norm(r.category);
      const it = norm(r.item_name);
      const sz = norm(r.size);
      return f.includes(q) || cat.includes(q) || it.includes(q) || sz.includes(q);
    });
  }, [salesRows, searchText]);

  const rowsCount = filteredRows.length;

  /* ---------------- cashout ---------------- */

  const openCashout = (agg: PersonAgg): void => {
    setCashoutTargetKey(agg.key);
    setCashoutTargetLabel(agg.label);
    setCashoutAmount("");
    setCashoutNote("");
  };

  const cashoutHistoryForTarget = useMemo(() => {
    if (!cashoutTargetKey) return [];
    return cashouts.filter((c) => {
      const label = groupBy === "category" ? show(c.category, "-") : show(c.full_name, "-");
      return norm(label) === cashoutTargetKey;
    });
  }, [cashoutTargetKey, cashouts, groupBy]);

  const submitCashout = async (): Promise<void> => {
    if (!cashoutTargetKey) return;

    const amt = round2(Math.max(0, Number(cashoutAmount) || 0));
    if (amt <= 0) {
      alert("Cashout amount must be > 0");
      return;
    }

    const target = perKeyAggAll.find((p) => p.key === cashoutTargetKey);
    const remaining = round2(target?.remaining ?? 0);

    // ✅ BLOCK OVER CASHOUT
    if (amt > remaining) {
      alert(`Insufficient remaining. Remaining: ${moneyText(remaining)}`);
      return;
    }

    try {
      setSavingCashout(true);

      // NOTE: your RPC is by full_name. If groupBy=category, this still passes label.
      const { error } = await supabase.rpc("cashout_consignment_oversale", {
        p_cashout_amount: amt,
        p_full_name: cashoutTargetLabel,
        p_note: cashoutNote.trim() || null,
      });

      if (error) {
        alert(`Cash out error: ${error.message}`);
        return;
      }

      setCashoutTargetKey(null);
      setCashoutTargetLabel("");
      await fetchAll();
    } catch (e: unknown) {
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
                Showing: <strong>ALL</strong> • Rows: <strong>{rowsCount}</strong> • Groups:{" "}
                <strong>{perKeyAgg.length}</strong>
              </div>

              {/* group toggle */}
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="receipt-btn" onClick={() => setGroupBy("full_name")} style={{ opacity: groupBy === "full_name" ? 1 : 0.6 }}>
                  Group by Full Name
                </button>
                <button className="receipt-btn" onClick={() => setGroupBy("category")} style={{ opacity: groupBy === "category" ? 1 : 0.6 }}>
                  Group by Category
                </button>
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
                    placeholder="Search fullname / category / item / size..."
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
          ) : perKeyAgg.length === 0 ? (
            <p className="customer-note">No consignment data found.</p>
          ) : (
            <>
              {/* TOP SUMMARY TABLE */}
              <div className="customer-table-wrap" style={{ marginBottom: 14 }}>
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>{groupBy === "category" ? "Category" : "Full Name"}</th>
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
                    {perKeyAgg.map((p) => (
                      <tr key={p.key}>
                        <td style={{ fontWeight: 1000 }}>{p.label}</td>
                        <td style={{ fontWeight: 900 }}>{p.total_restock}</td>
                        <td style={{ fontWeight: 900 }}>{p.total_sold}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.expected_total)}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.net_total)}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{moneyText(p.cashout_total)}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1100 }}>{moneyText(p.remaining)}</td>

                        <td>
                          <div className="action-stack">
                            <button
                              className="receipt-btn"
                              onClick={() => openCashout(p)}
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

                {groupBy === "category" ? (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    Note: Your cashout table has no <b>category</b> column, so grouping by category can’t compute cashouts correctly unless you add it.
                  </div>
                ) : null}
              </div>

              {/* DETAILS TABLE */}
              <div className="customer-table-wrap">
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>Item Name</th>
                      <th>Date/Time (PH)</th>
                      <th>Full Name</th>
                      <th>Category</th>
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
                          <td style={{ fontWeight: 900 }}>{show(r.full_name)}</td>
                          <td style={{ fontWeight: 900 }}>{show(r.category)}</td>
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
          {cashoutTargetKey && (
            <div className="receipt-overlay" onClick={() => (savingCashout ? null : setCashoutTargetKey(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CASH OUT</h3>
                <p className="receipt-subtitle">
                  {groupBy === "category" ? "Category: " : "Full Name: "}
                  {cashoutTargetLabel}
                </p>

                <hr />

                {(() => {
                  const p = perKeyAggAll.find((x) => x.key === cashoutTargetKey);

                  const gross = round2(p?.gross_total ?? 0);
                  const net = grossToNet(gross);

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
                              <div style={{ fontWeight: 1100, whiteSpace: "nowrap" }}>{moneyText(round2(toNumber(h.cashout_amount)))}</div>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="modal-actions" style={{ marginTop: 16 }}>
                        <button className="receipt-btn" onClick={() => setCashoutTargetKey(null)} disabled={savingCashout}>
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

          {!loading && perKeyAgg.length === 0 && <IonText />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Staff_Consignment_Record;
