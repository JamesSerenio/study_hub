import React, { useEffect, useState } from "react";
import { IonPage, IonContent, IonSpinner, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

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

const Customer_Add_ons: React.FC = () => {
  const [records, setRecords] = useState<CustomerAddOnMerged[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchAddOns();
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

    const sessionRows = (rows ?? []) as unknown as CustomerSessionAddOnRow[];

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

    const addOnMap = new Map<string, AddOnInfo>();
    ((addOnRows ?? []) as AddOnInfo[]).forEach((a) => addOnMap.set(a.id, a));

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

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <h2 style={{ fontWeight: 800, marginBottom: 12 }}>
          Customer Add-Ons Records
        </h2>

        {loading && (
          <div style={{ textAlign: "center", marginTop: 30 }}>
            <IonSpinner name="crescent" />
          </div>
        )}

        {!loading && records.length === 0 && (
          <IonText>No add-ons recorded.</IonText>
        )}

        {!loading && records.length > 0 && (
            <div className="customer-addons-container">
            <table className="customer-addons-table">
                <thead>
                <tr>
                    <th>Date</th>
                    <th>Full Name</th>
                    <th>Seat</th>
                    <th>Category</th>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                </tr>
                </thead>

                <tbody>
                {records.map((row) => (
                    <tr key={row.id}>
                    <td>
                        {row.created_at
                        ? new Date(row.created_at).toLocaleString()
                        : "-"}
                    </td>

                    <td>{row.full_name || "-"}</td>

                    <td>{row.seat_number || "-"}</td>

                    <td>{row.category}</td>

                    <td>{row.item_name}</td>

                    <td>{row.quantity}</td>

                    <td>₱{row.price.toFixed(2)}</td>

                    <td style={{ fontWeight: 800 }}>
                        ₱{row.total.toFixed(2)}
                    </td>
                    </tr>
                ))}
                </tbody>
            </table>
            </div>

        )}
      </IonContent>
    </IonPage>
  );
};

export default Customer_Add_ons;
