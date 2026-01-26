// src/pages/Admin_Staff_Expenses&Expired.tsx
// ✅ Admin view: staff expenses/expired logs
// ✅ Shows: full name, product, qty, type, date/time, description
// ✅ Admin can DELETE (no revert)
// ✅ Admin can VOID (reverts add_ons counts via DB trigger)
// ✅ STRICT TS, NO any, NO unknown, no unused locals

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonLabel,
  IonButton,
  IonIcon,
  IonToast,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonAlert,
  IonBadge,
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

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString();
};

const typeLabel = (t: ExpenseType): string =>
  t === "expired" ? "Expired" : "Staff Consumed";

const Admin_Staff_Expenses_Expired: React.FC = () => {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [toastOpen, setToastOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string>("");

  const [confirmVoid, setConfirmVoid] = useState<ExpenseRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseRow | null>(null);

  const [busyId, setBusyId] = useState<string>("");

  const fetchRows = async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("add_on_expenses")
        .select(
          "id, created_at, add_on_id, full_name, category, product_name, quantity, expense_type, description, voided, voided_at"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      // ✅ normalize to strict types (no blind casting)
      const normalized: ExpenseRow[] = (data ?? [])
        .map((r) => {
          const expenseType = String((r as { expense_type?: string }).expense_type ?? "");
          if (expenseType !== "expired" && expenseType !== "staff_consumed") return null;

          const qtyRaw = (r as { quantity?: number | string }).quantity;
          const qtyNum =
            typeof qtyRaw === "number"
              ? qtyRaw
              : typeof qtyRaw === "string"
              ? Number(qtyRaw)
              : 0;

          return {
            id: String((r as { id?: string }).id ?? ""),
            created_at: String((r as { created_at?: string }).created_at ?? ""),
            add_on_id: String((r as { add_on_id?: string }).add_on_id ?? ""),
            full_name: String((r as { full_name?: string }).full_name ?? ""),
            category: String((r as { category?: string }).category ?? ""),
            product_name: String((r as { product_name?: string }).product_name ?? ""),
            quantity: Number.isFinite(qtyNum) ? qtyNum : 0,
            expense_type: expenseType as ExpenseType,
            description: String((r as { description?: string }).description ?? ""),
            voided: Boolean((r as { voided?: boolean }).voided),
            voided_at: ((r as { voided_at?: string | null }).voided_at ?? null) as
              | string
              | null,
          };
        })
        .filter((x): x is ExpenseRow => x !== null);

      setRows(normalized);
    } catch (e) {
      console.error(e);
      setToastMsg("Failed to load expenses logs.");
      setToastOpen(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>): void => {
    void fetchRows().finally(() => event.detail.complete());
  };

  const activeRows = useMemo(() => rows, [rows]);

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
      await fetchRows();
    } catch (e) {
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
      await fetchRows();
    } catch (e) {
      console.error(e);
      setToastMsg("Failed to delete record.");
      setToastOpen(true);
    } finally {
      setBusyId("");
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Staff Expenses & Expired</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="admin-exp-topbar">
          <IonButton
            onClick={() => {
              void fetchRows();
            }}
            fill="outline"
          >
            <IonIcon slot="start" icon={refreshOutline} />
            Refresh
          </IonButton>

          <IonLabel className="admin-exp-count">
            Total records: <strong>{activeRows.length}</strong>
          </IonLabel>
        </div>

        {loading ? (
          <div className="admin-exp-loading">
            <IonSpinner />
            <IonLabel>Loading...</IonLabel>
          </div>
        ) : (
          <IonGrid className="admin-exp-grid">
            <IonRow className="admin-exp-head">
              <IonCol size="2">Full Name</IonCol>
              <IonCol size="2">Product</IonCol>
              <IonCol size="2">Category</IonCol>
              <IonCol size="1">Qty</IonCol>
              <IonCol size="2">Type</IonCol>
              <IonCol size="2">Date & Time</IonCol>
              <IonCol size="1">Action</IonCol>
            </IonRow>

            {activeRows.length === 0 ? (
              <IonRow>
                <IonCol size="12">
                  <IonLabel>No records.</IonLabel>
                </IonCol>
              </IonRow>
            ) : (
              activeRows.map((r) => (
                <IonRow
                  key={r.id}
                  className={`admin-exp-row ${r.voided ? "is-voided" : ""}`}
                >
                  <IonCol size="2">
                    <IonLabel className="admin-exp-strong">{r.full_name}</IonLabel>
                    {r.voided && (
                      <div className="admin-exp-sub">
                        <IonBadge color="medium">VOIDED</IonBadge>
                        {r.voided_at ? <span> {formatDateTime(r.voided_at)}</span> : null}
                      </div>
                    )}
                  </IonCol>

                  <IonCol size="2">
                    <IonLabel className="admin-exp-strong">{r.product_name}</IonLabel>
                    <div className="admin-exp-sub">{r.description}</div>
                  </IonCol>

                  <IonCol size="2">{r.category}</IonCol>

                  <IonCol size="1">
                    <IonBadge color="dark">{r.quantity}</IonBadge>
                  </IonCol>

                  <IonCol size="2">
                    <IonBadge
                      color={r.expense_type === "expired" ? "warning" : "tertiary"}
                    >
                      {typeLabel(r.expense_type)}
                    </IonBadge>
                  </IonCol>

                  <IonCol size="2">{formatDateTime(r.created_at)}</IonCol>

                  <IonCol size="1">
                    <div className="admin-exp-actions">
                      <IonButton
                        size="small"
                        color="danger"
                        fill="outline"
                        disabled={r.voided || busyId === r.id}
                        onClick={() => setConfirmVoid(r)}
                      >
                        <IonIcon slot="start" icon={closeCircleOutline} />
                        Void
                      </IonButton>

                      <IonButton
                        size="small"
                        color="medium"
                        fill="outline"
                        disabled={busyId === r.id}
                        onClick={() => setConfirmDelete(r)}
                      >
                        <IonIcon slot="start" icon={trashOutline} />
                        Delete
                      </IonButton>
                    </div>
                  </IonCol>
                </IonRow>
              ))
            )}
          </IonGrid>
        )}

        <IonAlert
          isOpen={!!confirmVoid}
          onDidDismiss={() => setConfirmVoid(null)}
          header="Void this record?"
          message={
            confirmVoid
              ? `This will restore stock by reverting ${typeLabel(
                  confirmVoid.expense_type
                )} (qty: ${confirmVoid.quantity}).`
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

        <IonToast
          isOpen={toastOpen}
          message={toastMsg}
          duration={2500}
          onDidDismiss={() => setToastOpen(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Admin_Staff_Expenses_Expired;
