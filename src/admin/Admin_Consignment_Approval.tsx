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
    <IonPage className="cons-approval-page">
      <IonHeader className="cons-approval-header"></IonHeader>

      <IonContent className="cons-approval-content">

        <div className="cons-approval-wrap">

          <div className="cons-approval-title">
            Consignment Approval
          </div>

          <div className="cons-approval-sub">
            Pending consignment items submitted by staff.
          </div>

          {loading ? (
            <div className="cons-approval-loading">
              <IonSpinner name="crescent" />
            </div>
          ) : items.length === 0 ? (
            <IonText className="cons-approval-empty">
              No pending consignment items.
            </IonText>
          ) : (
            items.map((item) => (
              <IonCard key={item.id} className="cons-approval-card">
                <IonCardContent>

                  <div className="cons-approval-grid">

                    {/* IMAGE */}
                    <div className="cons-approval-imageBox">
                      {item.image_url ? (
                        <IonImg
                          src={item.image_url}
                          alt={item.item_name}
                          className="cons-approval-image"
                        />
                      ) : (
                        <div className="cons-approval-noimg">
                          No Image
                        </div>
                      )}
                    </div>

                    {/* DETAILS */}
                    <div className="cons-approval-details">

                      <div className="cons-approval-itemname">
                        {item.item_name}
                      </div>

                      <div className="cons-approval-info">
                        <span><b>Full Name:</b> {item.full_name}</span>
                        <span><b>Category:</b> {item.category ?? "-"}</span>
                        <span><b>Size:</b> {item.size ?? "-"}</span>
                        <span><b>Price:</b> ₱{Number(item.price).toFixed(2)}</span>
                        <span><b>Restocked:</b> {item.restocked}</span>
                        <span><b>Status:</b> {item.approval_status}</span>
                      </div>

                      <IonItem lines="none" className="cons-approval-reason">
                        <IonLabel position="stacked">
                          Reject Reason (optional)
                        </IonLabel>

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

                      <div className="cons-approval-actions">

                        <IonButton
                          color="success"
                          className="cons-btn-approve"
                          onClick={() => handleApprove(item.id)}
                        >
                          Approve
                        </IonButton>

                        <IonButton
                          color="danger"
                          fill="outline"
                          className="cons-btn-reject"
                          onClick={() => handleReject(item.id)}
                        >
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