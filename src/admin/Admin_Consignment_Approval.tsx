// src/pages/Admin_Consignment_Approval.tsx
import React, { useEffect, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonContent,
  IonCard,
  IonCardContent,
  IonButton,
  IonToast,
  IonImg,
  IonText,
  IonSpinner,
  IonItem,
  IonLabel,
  IonTextarea,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type ConsignmentRow = {
  id: string;
  created_at: string;
  full_name: string;
  category: string | null;
  item_name: string;
  size: string | null;
  image_url: string | null;
  price: number;
  restocked: number;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
};

const Admin_Consignment_Approval: React.FC = () => {
  const [items, setItems] = useState<ConsignmentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string>("");
  const [showToast, setShowToast] = useState<boolean>(false);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const loadPending = async (): Promise<void> => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("consignment")
        .select(`
          id,
          created_at,
          full_name,
          category,
          item_name,
          size,
          image_url,
          price,
          restocked,
          approval_status,
          rejection_reason
        `)
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setItems((data ?? []) as ConsignmentRow[]);
    } catch (err: unknown) {
      console.error(err);
      setToastMessage(err instanceof Error ? err.message : "Failed to load pending consignment");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPending();
  }, []);

  const handleApprove = async (id: string): Promise<void> => {
    try {
      const { error } = await supabase.rpc("approve_consignment", {
        p_consignment_id: id,
      });

      if (error) throw error;

      setItems((prev) => prev.filter((item) => item.id !== id));
      setToastMessage("Consignment approved!");
      setShowToast(true);
    } catch (err: unknown) {
      console.error(err);
      setToastMessage(err instanceof Error ? err.message : "Approval failed");
      setShowToast(true);
    }
  };

  const handleReject = async (id: string): Promise<void> => {
    try {
      const reason = (rejectReasons[id] ?? "").trim();

      const { error } = await supabase.rpc("reject_consignment", {
        p_consignment_id: id,
        p_reason: reason || null,
      });

      if (error) throw error;

      setItems((prev) => prev.filter((item) => item.id !== id));
      setToastMessage("Consignment rejected!");
      setShowToast(true);
    } catch (err: unknown) {
      console.error(err);
      setToastMessage(err instanceof Error ? err.message : "Reject failed");
      setShowToast(true);
    }
  };

  return (
    <IonPage>
      <IonHeader></IonHeader>

      <IonContent className="ion-padding">
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h1>Consignment Approval</h1>
          <p>Pending consignment items for admin approval.</p>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "32px" }}>
              <IonSpinner name="crescent" />
            </div>
          ) : items.length === 0 ? (
            <IonText>No pending consignment items.</IonText>
          ) : (
            items.map((item) => (
              <IonCard key={item.id}>
                <IonCardContent>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "160px 1fr",
                      gap: "16px",
                      alignItems: "start",
                    }}
                  >
                    <div>
                      {item.image_url ? (
                        <IonImg
                          src={item.image_url}
                          alt={item.item_name}
                          style={{
                            width: "160px",
                            height: "160px",
                            objectFit: "cover",
                            borderRadius: "12px",
                            overflow: "hidden",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "160px",
                            height: "160px",
                            borderRadius: "12px",
                            background: "#f3f4f6",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          No Image
                        </div>
                      )}
                    </div>

                    <div>
                      <h2 style={{ marginTop: 0 }}>{item.item_name}</h2>
                      <p><strong>Full Name:</strong> {item.full_name}</p>
                      <p><strong>Category:</strong> {item.category ?? "-"}</p>
                      <p><strong>Size:</strong> {item.size ?? "-"}</p>
                      <p><strong>Price:</strong> ₱{Number(item.price).toFixed(2)}</p>
                      <p><strong>Restocked:</strong> {item.restocked}</p>
                      <p><strong>Status:</strong> {item.approval_status}</p>

                      <IonItem lines="none">
                        <IonLabel position="stacked">Reject Reason (optional)</IonLabel>
                        <IonTextarea
                          value={rejectReasons[item.id] ?? ""}
                          autoGrow
                          placeholder="Reason for rejection"
                          onIonInput={(e) =>
                            setRejectReasons((prev) => ({
                              ...prev,
                              [item.id]: String(e.detail.value ?? ""),
                            }))
                          }
                        />
                      </IonItem>

                      <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
                        <IonButton color="success" onClick={() => handleApprove(item.id)}>
                          Approve
                        </IonButton>

                        <IonButton color="danger" fill="outline" onClick={() => handleReject(item.id)}>
                          Reject
                        </IonButton>
                      </div>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>
            ))
          )}
        </div>

        <IonToast
          isOpen={showToast}
          message={toastMessage}
          duration={2200}
          onDidDismiss={() => setShowToast(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Admin_Consignment_Approval;