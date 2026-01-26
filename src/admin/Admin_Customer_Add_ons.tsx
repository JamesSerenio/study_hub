// src/pages/Admin_Customer_Add_ons.tsx
// ✅ Calendar (date) filter
// ✅ Export to Excel (CSV) by selected date (UTF-8 BOM + force Date as TEXT)
// ✅ VOID (single row): reverses by decrementing add_ons.sold then deletes record
// ✅ DELETE (single row): deletes record ONLY (no reversal)
// ✅ DELETE BY DATE: deletes records on selected date ONLY (no reversal)
// ✅ No "any"

// NOTE: add_ons.stocks and add_ons.overall_sales are GENERATED ALWAYS,
// so we must update add_ons.sold to "return stock / reverse sales".

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonContent,
  IonSpinner,
  IonText,
  IonButton,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type NumericLike = number | string;

interface AddOnInfo {
  id: string;
  sold: NumericLike;
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
}

const toNumber = (v: NumericLike | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const extractLocalDate = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return yyyyMmDdLocal(d);
};

const csvEscape = (v: string): string => `"${v.replace(/"/g, '""')}"`;

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("en-PH");
};

const formatTimeText = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
};

// local-day range [start,end] for timestamptz filtering
const localDayRangeIso = (yyyyMmDd: string): { startIso: string; endIso: string } => {
  const [y, m, d] = yyyyMmDd.split("-").map((x) => Number(x));
  const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const end = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

const Admin_Customer_Add_ons: React.FC = () => {
  const [records, setRecords] = useState<CustomerAddOnMerged[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

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
          seat_number
        `
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching customer_session_add_ons:", error);
      setRecords([]);
      setLoading(false);
      return;
    }

    const sessionRows = (rows ?? []) as CustomerSessionAddOnRow[];
    if (sessionRows.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    const addOnIds = Array.from(new Set(sessionRows.map((r) => r.add_on_id)));

    const { data: addOnRows, error: addOnErr } = await supabase
      .from("add_ons")
      .select("id, name, category")
      .in("id", addOnIds);

    if (addOnErr) console.error("Error fetching add_ons:", addOnErr);

    const addOnMap = new Map<string, { id: string; name: string; category: string }>();
    (addOnRows ?? []).forEach((a: { id: string; name: string; category: string }) =>
      addOnMap.set(a.id, a)
    );

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
      };
    });

    setRecords(merged);
    setLoading(false);
  };

  const filteredRecords = useMemo(() => {
    return records.filter((r) => extractLocalDate(r.created_at) === selectedDate);
  }, [records, selectedDate]);

  // ✅ VOID (single): reverse by decrementing add_ons.sold, then delete record
  const voidOneRecord = async (row: CustomerAddOnMerged): Promise<void> => {
    const ok = window.confirm(
      `VOID this add-on record?\n\n${row.full_name}\nSeat: ${row.seat_number}\nItem: ${row.item_name}\nQty: ${row.quantity}\nTotal: ₱${row.total.toFixed(2)}\nDate: ${formatDateTime(row.created_at)}\n\nThis will RETURN stock and REVERSE sales.`
    );
    if (!ok) return;

    try {
      setVoidingId(row.id);

      const qty = Number.isFinite(row.quantity) ? row.quantity : 0;

      // 1) read current sold
      const { data: addOn, error: addOnErr } = await supabase
        .from("add_ons")
        .select("id, sold")
        .eq("id", row.add_on_id)
        .single();

      if (addOnErr || !addOn) {
        alert(`VOID error: cannot read add_ons. ${addOnErr?.message ?? ""}`.trim());
        return;
      }

      const currentSold = toNumber((addOn as AddOnInfo).sold);
      const nextSold = Math.max(0, currentSold - qty);

      // 2) update sold ONLY (stocks + overall_sales are generated)
      const { error: updErr } = await supabase
        .from("add_ons")
        .update({ sold: nextSold })
        .eq("id", row.add_on_id);

      if (updErr) {
        alert(`VOID error: failed to reverse sold. ${updErr.message}`);
        return;
      }

      // 3) delete the record row
      const { error: delErr } = await supabase
        .from("customer_session_add_ons")
        .delete()
        .eq("id", row.id);

      if (delErr) {
        alert(`VOID error: reversed sold but failed to delete record. ${delErr.message}`);
        return;
      }

      // update UI
      setRecords((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      console.error(e);
      alert("VOID failed.");
    } finally {
      setVoidingId(null);
    }
  };

  // ✅ DELETE (single): delete record ONLY (no reversal)
  const deleteOneRecord = async (row: CustomerAddOnMerged): Promise<void> => {
    const ok = window.confirm(
      `DELETE this add-on record?\n\n${row.full_name}\nSeat: ${row.seat_number}\nItem: ${row.item_name}\nQty: ${row.quantity}\nTotal: ₱${row.total.toFixed(2)}\nDate: ${formatDateTime(row.created_at)}\n\nThis will NOT return stock and NOT reverse sales.`
    );
    if (!ok) return;

    try {
      setDeletingId(row.id);

      const { error: delErr } = await supabase
        .from("customer_session_add_ons")
        .delete()
        .eq("id", row.id);

      if (delErr) {
        alert(`DELETE error: ${delErr.message}`);
        return;
      }

      setRecords((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      console.error(e);
      alert("DELETE failed.");
    } finally {
      setDeletingId(null);
    }
  };

  // ✅ DELETE BY DATE: delete records on selected date ONLY (no reversal)
  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) return;

    const ok = window.confirm(
      `DELETE ALL add-ons on date: ${selectedDate}?\n\nThis will NOT return stock and NOT reverse sales.`
    );
    if (!ok) return;

    try {
      setDeletingDate(selectedDate);

      const { startIso, endIso } = localDayRangeIso(selectedDate);

      const { error: delErr } = await supabase
        .from("customer_session_add_ons")
        .delete()
        .gte("created_at", startIso)
        .lte("created_at", endIso);

      if (delErr) {
        alert(`DELETE by date error: ${delErr.message}`);
        return;
      }

      // remove from UI
      setRecords((prev) => prev.filter((r) => extractLocalDate(r.created_at) !== selectedDate));
    } catch (e) {
      console.error(e);
      alert("DELETE by date failed.");
    } finally {
      setDeletingDate(null);
    }
  };

  // ✅ Export CSV (by selected date only)
  const exportToExcelByDate = (): void => {
    if (!selectedDate) {
      alert("Please select a date.");
      return;
    }
    if (filteredRecords.length === 0) {
      alert("No records for selected date.");
      return;
    }

    const headers = [
      "Date",
      "Time",
      "Full Name",
      "Seat",
      "Category",
      "Item",
      "Qty",
      "Price",
      "Total",
    ];

    const rows = filteredRecords.map((r) => {
      const d = extractLocalDate(r.created_at);
      const t = formatTimeText(r.created_at);
      return [
        `\t${d}`,
        `\t${t}`,
        r.full_name ?? "",
        r.seat_number ?? "",
        r.category ?? "",
        r.item_name ?? "",
        String(r.quantity ?? 0),
        r.price.toFixed(2),
        r.total.toFixed(2),
      ];
    });

    const csv =
      "\ufeff" +
      [headers, ...rows]
        .map((r) => r.map((v) => csvEscape(String(v ?? ""))).join(","))
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `admin-addons-${selectedDate}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <h2 style={{ fontWeight: 900, margin: 0 }}>Admin Add-Ons Records</h2>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.currentTarget.value)}
            />

            <IonButton onClick={exportToExcelByDate} style={{ height: 36 }}>
              Export Excel (Date)
            </IonButton>

            <IonButton
              color="danger"
              onClick={deleteByDate}
              disabled={deletingDate === selectedDate}
              style={{ height: 36 }}
            >
              {deletingDate === selectedDate ? "Deleting..." : "Delete by Date"}
            </IonButton>
          </div>
        </div>

        <div style={{ marginBottom: 10, opacity: 0.85 }}>
          Showing records for: <strong>{selectedDate}</strong>
        </div>

        {loading && (
          <div style={{ textAlign: "center", marginTop: 30 }}>
            <IonSpinner name="crescent" />
          </div>
        )}

        {!loading && filteredRecords.length === 0 && (
          <IonText>No add-ons found for this date.</IonText>
        )}

        {!loading && filteredRecords.length > 0 && (
          <div className="customer-addons-container">
            <table className="customer-addons-table">
              <thead>
                <tr>
                  <th>Date/Time</th>
                  <th>Full Name</th>
                  <th>Seat</th>
                  <th>Category</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                  <th style={{ minWidth: 170 }}>Action</th>
                </tr>
              </thead>

              <tbody>
                {filteredRecords.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>{row.full_name || "-"}</td>
                    <td>{row.seat_number || "-"}</td>
                    <td>{row.category}</td>
                    <td>{row.item_name}</td>
                    <td>{row.quantity}</td>
                    <td>₱{row.price.toFixed(2)}</td>
                    <td style={{ fontWeight: 900 }}>₱{row.total.toFixed(2)}</td>

                    <td style={{ display: "flex", gap: 8 }}>
                      <button
                        className="receipt-btn"
                        disabled={voidingId === row.id || deletingId === row.id}
                        onClick={() => void voidOneRecord(row)}
                      >
                        {voidingId === row.id ? "Voiding..." : "Void"}
                      </button>

                      <button
                        className="receipt-btn"
                        style={{ opacity: 0.9 }}
                        disabled={voidingId === row.id || deletingId === row.id}
                        onClick={() => void deleteOneRecord(row)}
                      >
                        {deletingId === row.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filteredRecords.length > 0 && (
          <div className="customer-addons-container">
            <table className="customer-addons-table">
              {/* ...table... */}
            </table>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Admin_Customer_Add_ons;
