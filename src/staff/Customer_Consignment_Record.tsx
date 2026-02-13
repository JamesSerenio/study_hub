import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type NumericLike = number | string;
type GroupBy = "full_name" | "category";
type PayMethod = "cash" | "gcash";

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
  category: string | null;

  cashout_amount: NumericLike;
  payment_method: PayMethod;
  note: string | null;
}

interface CashOutRowNoCategory {
  id: string;
  created_at: string;

  full_name: string;

  cashout_amount: NumericLike;
  payment_method: PayMethod;
  note: string | null;
}

interface CashOutRowNoMethod {
  id: string;
  created_at: string;

  full_name: string;
  category: string | null;

  cashout_amount: NumericLike;
  note: string | null;
}

type ConsignmentRestockInsert = {
  consignment_id: string;
  qty: number;
  full_name: string;
  category: string | null;
  item_name: string;
  size: string | null;
  image_url: string | null;
};

type CancelledInsert = {
  consignment_id: string;
  original_created_at: string | null;
  created_by: string | null;
  category_id: string | null;

  full_name: string;
  category: string | null;
  item_name: string;
  size: string | null;
  image_url: string | null;

  price: number;
  restocked: number;
  sold: number;

  note: string | null;
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

const grossToNet = (gross: number): number => round2(gross * 0.85);

const labelPay = (m: PayMethod): string => (m === "gcash" ? "GCASH" : "CASH");

/* ---------------- money rules ---------------- */

type PersonAgg = {
  key: string;
  label: string;

  total_restock: number;
  total_sold: number;

  expected_total: number;
  gross_total: number;
  net_total: number;

  cashout_cash: number;
  cashout_gcash: number;
  cashout_total: number;

  remaining: number; // net_total - cashouts
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

  const [cashAmount, setCashAmount] = useState<string>("");
  const [gcashAmount, setGcashAmount] = useState<string>("");

  const [cashoutNote, setCashoutNote] = useState<string>("");
  const [savingCashout, setSavingCashout] = useState<boolean>(false);

  // history modal
  const [historyTargetKey, setHistoryTargetKey] = useState<string | null>(null);
  const [historyTargetLabel, setHistoryTargetLabel] = useState<string>("");

  // restock
  const [restockTarget, setRestockTarget] = useState<ConsignmentRow | null>(null);
  const [restockQty, setRestockQty] = useState<string>("");
  const [savingRestock, setSavingRestock] = useState<boolean>(false);

  // ✅ CANCEL (instead of delete)
  const [cancelTarget, setCancelTarget] = useState<ConsignmentRow | null>(null);
  const [cancelNote, setCancelNote] = useState<string>("");
  const [cancelling, setCancelling] = useState<boolean>(false);

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

    // 1) try: has category + payment_method
    const withCatMethod = await supabase
      .from("consignment_cash_outs")
      .select("id, created_at, full_name, category, cashout_amount, payment_method, note")
      .order("created_at", { ascending: false })
      .returns<CashOutRow[]>();

    if (!withCatMethod.error) {
      const mapped = (withCatMethod.data ?? []).map((r) => ({
        ...r,
        payment_method: (String((r as unknown as { payment_method?: unknown }).payment_method ?? "cash").toLowerCase() === "gcash"
          ? "gcash"
          : "cash") as PayMethod,
      }));
      setSalesRows(sales ?? []);
      setCashouts(mapped);
      setLoading(false);
      return;
    }

    // 2) fallback: no category but has payment_method
    const noCatMethod = await supabase
      .from("consignment_cash_outs")
      .select("id, created_at, full_name, cashout_amount, payment_method, note")
      .order("created_at", { ascending: false })
      .returns<CashOutRowNoCategory[]>();

    if (!noCatMethod.error) {
      const mapped: CashOutRow[] = (noCatMethod.data ?? []).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        full_name: r.full_name,
        category: null,
        cashout_amount: r.cashout_amount,
        payment_method: (String((r as unknown as { payment_method?: unknown }).payment_method ?? "cash").toLowerCase() === "gcash"
          ? "gcash"
          : "cash") as PayMethod,
        note: r.note,
      }));
      setSalesRows(sales ?? []);
      setCashouts(mapped);
      setLoading(false);
      return;
    }

    // 3) last fallback: old table (no payment_method) -> treat as CASH
    const old = await supabase
      .from("consignment_cash_outs")
      .select("id, created_at, full_name, category, cashout_amount, note")
      .order("created_at", { ascending: false })
      .returns<CashOutRowNoMethod[]>();

    if (old.error) {
      // eslint-disable-next-line no-console
      console.error("FETCH CASH OUTS ERROR:", old.error);
      setSalesRows(sales ?? []);
      setCashouts([]);
      setLoading(false);
      return;
    }

    const mapped: CashOutRow[] = (old.data ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      full_name: r.full_name,
      category: r.category ?? null,
      cashout_amount: r.cashout_amount,
      payment_method: "cash",
      note: r.note,
    }));

    setSalesRows(sales ?? []);
    setCashouts(mapped);
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
        cashout_cash: 0,
        cashout_gcash: 0,
        cashout_total: 0,
        remaining: 0,
      };

      map.set(key, fresh);
      return fresh;
    };

    // sales => expected/gross
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

    // net totals
    for (const a of map.values()) a.net_total = grossToNet(a.gross_total);

    // cashouts
    for (const c of cashouts) {
      const label = groupBy === "category" ? show(c.category, "-") : show(c.full_name, "-");
      const key = norm(label);
      const a = getOrCreate(key, label);

      const amt = round2(toNumber(c.cashout_amount));
      if (c.payment_method === "gcash") a.cashout_gcash = round2(a.cashout_gcash + amt);
      else a.cashout_cash = round2(a.cashout_cash + amt);

      a.cashout_total = round2(a.cashout_cash + a.cashout_gcash);
    }

    // remaining
    for (const a of map.values()) a.remaining = round2(Math.max(0, a.net_total - a.cashout_total));

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

  /* ---------------- cashout + history ---------------- */

  const openCashout = (agg: PersonAgg): void => {
    setCashoutTargetKey(agg.key);
    setCashoutTargetLabel(agg.label);

    setCashAmount("");
    setGcashAmount("");
    setCashoutNote("");
  };

  const openHistory = (agg: PersonAgg): void => {
    setHistoryTargetKey(agg.key);
    setHistoryTargetLabel(agg.label);
  };

  const cashoutHistoryForTarget = useMemo(() => {
    if (!cashoutTargetKey) return [];
    return cashouts.filter((c) => {
      const label = groupBy === "category" ? show(c.category, "-") : show(c.full_name, "-");
      return norm(label) === cashoutTargetKey;
    });
  }, [cashoutTargetKey, cashouts, groupBy]);

  const historyForTarget = useMemo(() => {
    if (!historyTargetKey) return [];
    return cashouts.filter((c) => {
      const label = groupBy === "category" ? show(c.category, "-") : show(c.full_name, "-");
      return norm(label) === historyTargetKey;
    });
  }, [historyTargetKey, cashouts, groupBy]);

  const groupHasAnyHistory = (aggKey: string): boolean => {
    return cashouts.some((c) => {
      const label = groupBy === "category" ? show(c.category, "-") : show(c.full_name, "-");
      return norm(label) === aggKey;
    });
  };

  const submitCashout = async (): Promise<void> => {
    if (!cashoutTargetKey) return;

    const cash = round2(Math.max(0, Number(cashAmount) || 0));
    const gcash = round2(Math.max(0, Number(gcashAmount) || 0));
    const total = round2(cash + gcash);

    if (total <= 0) {
      alert("Please enter CASH or GCASH amount (must be > 0).");
      return;
    }

    const target = perKeyAggAll.find((p) => p.key === cashoutTargetKey);
    const remaining = round2(target?.remaining ?? 0);

    if (total > remaining) {
      alert(`Insufficient remaining. Remaining: ${moneyText(remaining)}`);
      return;
    }

    try {
      setSavingCashout(true);

      const note = cashoutNote.trim() || null;

      if (groupBy === "category") {
        const try1 = await supabase.rpc("cashout_consignment_oversale", {
          p_full_name: "CATEGORY",
          p_cash_amount: cash,
          p_gcash_amount: gcash,
          p_note: note,
          p_category: cashoutTargetLabel,
        });

        if (try1.error) {
          const try2 = await supabase.rpc("cashout_consignment_oversale", {
            p_full_name: cashoutTargetLabel,
            p_cash_amount: cash,
            p_gcash_amount: gcash,
            p_note: note,
          });

          if (try2.error) {
            alert(`Cash out error: ${try2.error.message}`);
            return;
          }
        }
      } else {
        const { error } = await supabase.rpc("cashout_consignment_oversale", {
          p_full_name: cashoutTargetLabel,
          p_cash_amount: cash,
          p_gcash_amount: gcash,
          p_note: note,
        });

        if (error) {
          alert(`Cash out error: ${error.message}`);
          return;
        }
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

  /* ---------------- restock (with record) ---------------- */

  const openRestock = (r: ConsignmentRow): void => {
    setRestockTarget(r);
    setRestockQty("");
  };

  const saveRestock = async (): Promise<void> => {
    if (!restockTarget) return;

    const addQty = Math.max(0, Math.floor(Number(restockQty) || 0));
    if (addQty <= 0) {
      alert("Restock quantity must be > 0");
      return;
    }

    const current = Math.max(0, Math.floor(Number(restockTarget.restocked ?? 0) || 0));
    const next = current + addQty;

    try {
      setSavingRestock(true);

      // ✅ 1) insert record
      const insertPayload: ConsignmentRestockInsert = {
        consignment_id: restockTarget.id,
        qty: addQty,
        full_name: show(restockTarget.full_name, "-"),
        category: restockTarget.category ?? null,
        item_name: show(restockTarget.item_name, "-"),
        size: restockTarget.size ?? null,
        image_url: restockTarget.image_url ?? null,
      };

      const ins = await supabase.from("consignment_restocks").insert(insertPayload).select("id").maybeSingle();
      if (ins.error) {
        alert(`Restock record failed: ${ins.error.message}`);
        return;
      }

      // ✅ 2) update consignment.restocked
      const { error } = await supabase.from("consignment").update({ restocked: next }).eq("id", restockTarget.id);

      if (error) {
        alert(`Restock failed: ${error.message}`);
        return;
      }

      setRestockTarget(null);
      await fetchAll();
    } finally {
      setSavingRestock(false);
    }
  };

  /* ---------------- CANCEL (archive then delete) ---------------- */

  const openCancel = (r: ConsignmentRow): void => {
    setCancelTarget(r);
    setCancelNote("");
  };

  const doCancel = async (): Promise<void> => {
    if (!cancelTarget) return;

    try {
      setCancelling(true);

      // best-effort: read missing snapshot fields if you want (category_id/created_by)
      // ✅ If your consignment table really has category_id/created_by, you can fetch it here.
      const more = await supabase
        .from("consignment")
        .select("id, created_at, created_by, category_id, full_name, category, item_name, size, image_url, price, restocked, sold")
        .eq("id", cancelTarget.id)
        .maybeSingle();

      if (more.error || !more.data) {
        alert(`Cancel failed: unable to read item.`);
        return;
      }

      const d = more.data as unknown as {
        id: string;
        created_at: string;
        created_by: string | null;
        category_id: string | null;
        full_name: string;
        category: string | null;
        item_name: string;
        size: string | null;
        image_url: string | null;
        price: number | string;
        restocked: number | null;
        sold: number | null;
      };

      // ✅ 1) insert into cancelled archive
      const archivePayload: CancelledInsert = {
        consignment_id: d.id,
        original_created_at: d.created_at ?? null,
        created_by: d.created_by ?? null,
        category_id: d.category_id ?? null,

        full_name: show(d.full_name, "-"),
        category: d.category ?? null,
        item_name: show(d.item_name, "-"),
        size: d.size ?? null,
        image_url: d.image_url ?? null,

        price: round2(toNumber(d.price)),
        restocked: Math.max(0, Math.floor(Number(d.restocked ?? 0) || 0)),
        sold: Math.max(0, Math.floor(Number(d.sold ?? 0) || 0)),

        note: cancelNote.trim() ? cancelNote.trim() : null,
      };

      const ins = await supabase.from("consignment_cancelled").insert(archivePayload).select("id").maybeSingle();
      if (ins.error) {
        alert(`Cancel failed (archive): ${ins.error.message}`);
        return;
      }

      // ✅ 2) delete from consignment
      const del = await supabase.from("consignment").delete().eq("id", cancelTarget.id);
      if (del.error) {
        alert(`Cancel failed (delete): ${del.error.message}`);
        return;
      }

      setCancelTarget(null);
      await fetchAll();
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Cancel failed.");
    } finally {
      setCancelling(false);
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
                Showing: <strong>ALL</strong> • Rows: <strong>{rowsCount}</strong> • Groups: <strong>{perKeyAgg.length}</strong>
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="receipt-btn" onClick={() => setGroupBy("full_name")} style={{ opacity: groupBy === "full_name" ? 1 : 0.6 }}>
                  Group by Full Name
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
                    {perKeyAgg.map((p) => {
                      const hasHistory = groupHasAnyHistory(p.key);

                      return (
                        <tr key={p.key}>
                          <td style={{ fontWeight: 1000 }}>{p.label}</td>
                          <td style={{ fontWeight: 900 }}>{p.total_restock}</td>
                          <td style={{ fontWeight: 900 }}>{p.total_sold}</td>
                          <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.expected_total)}</td>
                          <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.net_total)}</td>

                          <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>
                            {moneyText(p.cashout_total)}
                            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                              Cash: {moneyText(p.cashout_cash)} • GCash: {moneyText(p.cashout_gcash)}
                            </div>
                          </td>

                          <td style={{ whiteSpace: "nowrap", fontWeight: 1100 }}>{moneyText(p.remaining)}</td>

                          <td>
                            <div className="action-stack" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button className="receipt-btn" onClick={() => openCashout(p)} disabled={p.remaining <= 0} title={p.remaining <= 0 ? "No remaining" : "Cash out"}>
                                Cash Out
                              </button>

                              <button
                                className="receipt-btn"
                                onClick={() => openHistory(p)}
                                disabled={!hasHistory}
                                title={!hasHistory ? "No history" : "View history"}
                                style={{ opacity: !hasHistory ? 0.7 : 1 }}
                              >
                                History
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                      <th>Action</th>
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

                          <td>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {/* ✅ EDIT REMOVED */}

                              <button className="receipt-btn" onClick={() => openRestock(r)}>
                                Restock
                              </button>

                              {/* ✅ DELETE -> CANCEL */}
                              <button className="receipt-btn" onClick={() => openCancel(r)} style={{ opacity: 0.95 }}>
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ✅ HISTORY MODAL (read-only) */}
          {historyTargetKey && (
            <div className="receipt-overlay" onClick={() => setHistoryTargetKey(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">HISTORY</h3>
                <p className="receipt-subtitle">
                  {groupBy === "category" ? "Category: " : "Full Name: "}
                  {historyTargetLabel}
                </p>

                <hr />

                {(() => {
                  const p = perKeyAggAll.find((x) => x.key === historyTargetKey);

                  const gross = round2(p?.gross_total ?? 0);
                  const net = grossToNet(gross);

                  const remaining = round2(p?.remaining ?? 0);
                  const cash = round2(p?.cashout_cash ?? 0);
                  const gcash = round2(p?.cashout_gcash ?? 0);
                  const totalCashouts = round2(p?.cashout_total ?? 0);
                  const expected = round2(p?.expected_total ?? 0);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Expected Total</span>
                        <span>{moneyText(expected)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Overall Sales (NET)</span>
                        <span>{moneyText(net)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash Outs (Total)</span>
                        <span>{moneyText(totalCashouts)}</span>
                      </div>

                      <div className="receipt-row" style={{ opacity: 0.9 }}>
                        <span> └ Cash</span>
                        <span>{moneyText(cash)}</span>
                      </div>
                      <div className="receipt-row" style={{ opacity: 0.9 }}>
                        <span> └ GCash</span>
                        <span>{moneyText(gcash)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining</span>
                        <span style={{ fontWeight: 1000 }}>{moneyText(remaining)}</span>
                      </div>

                      <hr />

                      <div style={{ marginTop: 6, fontWeight: 900 }}>Cash Out History (all time)</div>

                      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                        {historyForTarget.length === 0 ? (
                          <div style={{ opacity: 0.8, fontSize: 13 }}>No cash outs yet.</div>
                        ) : (
                          historyForTarget.map((h) => (
                            <div
                              key={h.id}
                              style={{
                                border: "1px solid rgba(0,0,0,0.10)",
                                borderRadius: 12,
                                padding: 10,
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 10,
                                alignItems: "flex-start",
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 1000 }}>
                                  {formatPHDateTime(h.created_at)} • {labelPay(h.payment_method)}
                                </div>
                                {h.note ? <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{h.note}</div> : null}
                              </div>

                              <div style={{ fontWeight: 1100, whiteSpace: "nowrap" }}>{moneyText(round2(toNumber(h.cashout_amount)))}</div>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="modal-actions" style={{ marginTop: 16 }}>
                        <button className="receipt-btn" onClick={() => setHistoryTargetKey(null)}>
                          Close
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
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
                  const cash = round2(p?.cashout_cash ?? 0);
                  const gcash = round2(p?.cashout_gcash ?? 0);
                  const totalCashouts = round2(p?.cashout_total ?? 0);
                  const expected = round2(p?.expected_total ?? 0);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Expected Total</span>
                        <span>{moneyText(expected)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Overall Sales (NET)</span>
                        <span>{moneyText(net)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash Outs (Total)</span>
                        <span>{moneyText(totalCashouts)}</span>
                      </div>

                      <div className="receipt-row" style={{ opacity: 0.9 }}>
                        <span> └ Cash</span>
                        <span>{moneyText(cash)}</span>
                      </div>
                      <div className="receipt-row" style={{ opacity: 0.9 }}>
                        <span> └ GCash</span>
                        <span>{moneyText(gcash)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining</span>
                        <span style={{ fontWeight: 1000 }}>{moneyText(remaining)}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Cash Amount</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashAmount}
                          onChange={(e) => setCashAmount(e.currentTarget.value)}
                          placeholder="0.00"
                          disabled={savingCashout}
                        />
                      </div>

                      <div className="receipt-row" style={{ marginTop: 8 }}>
                        <span>GCash Amount</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={gcashAmount}
                          onChange={(e) => setGcashAmount(e.currentTarget.value)}
                          placeholder="0.00"
                          disabled={savingCashout}
                        />
                      </div>

                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
                        Total Cashout: <b>{moneyText(round2((Number(cashAmount) || 0) + (Number(gcashAmount) || 0)))}</b>
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
                                <div style={{ fontWeight: 900 }}>
                                  {formatPHDateTime(h.created_at)} • {labelPay(h.payment_method)}
                                </div>
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

          {/* RESTOCK MODAL */}
          {restockTarget && (
            <div className="receipt-overlay" onClick={() => (savingRestock ? null : setRestockTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">RESTOCK</h3>
                <p className="receipt-subtitle">
                  {restockTarget.item_name} • Current Restock: <b>{Math.max(0, Math.floor(Number(restockTarget.restocked ?? 0) || 0))}</b>
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Add Qty</span>
                  <input className="money-input" type="number" min="1" step="1" value={restockQty} onChange={(e) => setRestockQty(e.currentTarget.value)} placeholder="0" disabled={savingRestock} />
                </div>

                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>This will create a restock RECORD and add to restocked.</div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setRestockTarget(null)} disabled={savingRestock}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void saveRestock()} disabled={savingRestock}>
                    {savingRestock ? "Saving..." : "Restock"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ CANCEL MODAL */}
          {cancelTarget && (
            <div className="receipt-overlay" onClick={() => (cancelling ? null : setCancelTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL ITEM</h3>
                <p className="receipt-subtitle">
                  Cancel <b>{cancelTarget.item_name}</b>?
                </p>

                <hr />

                <div style={{ display: "grid", gap: 8, fontSize: 13, opacity: 0.95 }}>
                  <div>
                    Full Name: <b>{show(cancelTarget.full_name)}</b>
                  </div>
                  <div>
                    Category: <b>{show(cancelTarget.category)}</b>
                  </div>
                  <div>
                    Restocked: <b>{Math.max(0, Math.floor(Number(cancelTarget.restocked ?? 0) || 0))}</b> • Sold:{" "}
                    <b>{Math.max(0, Math.floor(Number(cancelTarget.sold ?? 0) || 0))}</b>
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Image: <b>{cancelTarget.image_url ? "kept (archived url)" : "none"}</b>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Note (optional)</div>
                  <textarea
                    value={cancelNote}
                    onChange={(e) => setCancelNote(e.currentTarget.value)}
                    placeholder="Reason / remarks..."
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
                    disabled={cancelling}
                  />
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void doCancel()} disabled={cancelling} style={{ opacity: 0.95 }}>
                    {cancelling ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
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
