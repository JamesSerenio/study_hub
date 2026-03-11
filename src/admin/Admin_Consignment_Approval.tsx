import React, { useEffect, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonContent,
  IonButton,
  IonToast,
  IonImg,
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
    <IonPage className="aca-page">
      <IonHeader className="aca-header"></IonHeader>

      <IonContent className="aca-content">
        <div className="aca-shell">
          <div className="aca-head">
            <h1 className="aca-title">Consignment Approval</h1>
            <p className="aca-subtitle">Review and approve pending consignment items.</p>
          </div>

          {loading ? (
            <div className="aca-loading">
              <IonSpinner name="crescent" />
            </div>
          ) : items.length === 0 ? (
            <div className="aca-empty">No pending consignment items.</div>
          ) : (
            <div className="aca-list">
              {items.map((item) => (
                <div key={item.id} className="aca-card">
                  <div className="aca-card-grid">
                    <div className="aca-image-wrap">
                      {item.image_url ? (
                        <IonImg src={item.image_url} alt={item.item_name} className="aca-image" />
                      ) : (
                        <div className="aca-no-image">No Image</div>
                      )}
                    </div>

                    <div className="aca-details">
                      <div className="aca-item-title">{item.item_name}</div>

                      <div className="aca-info-grid">
                        <div className="aca-info-pill">
                          <span className="aca-info-label">Full Name</span>
                          <span className="aca-info-value">{item.full_name}</span>
                        </div>

                        <div className="aca-info-pill">
                          <span className="aca-info-label">Category</span>
                          <span className="aca-info-value">{item.category ?? "-"}</span>
                        </div>

                        <div className="aca-info-pill">
                          <span className="aca-info-label">Size</span>
                          <span className="aca-info-value">{item.size ?? "-"}</span>
                        </div>

                        <div className="aca-info-pill">
                          <span className="aca-info-label">Price</span>
                          <span className="aca-info-value">₱{Number(item.price).toFixed(2)}</span>
                        </div>

                        <div className="aca-info-pill">
                          <span className="aca-info-label">Restocked</span>
                          <span className="aca-info-value">{item.restocked}</span>
                        </div>

                        <div className="aca-info-pill">
                          <span className="aca-info-label">Status</span>
                          <span className="aca-info-value aca-status">{item.approval_status}</span>
                        </div>
                      </div>

                      <IonItem lines="none" className="aca-reason-item">
                        <IonLabel position="stacked" className="aca-reason-label">
                          Reject Reason (optional)
                        </IonLabel>

                        <IonTextarea
                          className="aca-reason-textarea"
                          value={rejectReasons[item.id] ?? ""}
                          autoGrow
                          placeholder="Type reason here..."
                          onIonInput={(e) =>
                            setRejectReasons((prev) => ({
                              ...prev,
                              [item.id]: String(e.detail.value ?? ""),
                            }))
                          }
                        />
                      </IonItem>

                      <div className="aca-actions">
                        <IonButton
                          className="aca-btn aca-btn-approve"
                          onClick={() => handleApprove(item.id)}
                        >
                          Approve
                        </IonButton>

                        <IonButton
                          className="aca-btn aca-btn-reject"
                          fill="outline"
                          onClick={() => handleReject(item.id)}
                        >
                          Reject
                        </IonButton>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
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