import React, { useEffect, useMemo, useState } from "react";
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
  IonSegment,
  IonSegmentButton,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type ApprovalStatus = "pending" | "approved" | "rejected";
type HistoryFilter = "all" | "approved" | "rejected";

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
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  approved_at: string | null;
};

const formatDateTime = (value: string | null): string => {
  if (!value) return "-";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";

  return d.toLocaleString();
};

const Admin_Consignment_Approval: React.FC = () => {
  const [items, setItems] = useState<ConsignmentRow[]>([]);
  const [historyItems, setHistoryItems] = useState<ConsignmentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string>("");
  const [showToast, setShowToast] = useState<boolean>(false);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");

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
          rejection_reason,
          approved_at
        `)
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setItems((data ?? []) as ConsignmentRow[]);
    } catch (err: unknown) {
      console.error("loadPending error:", err);
      setToastMessage(err instanceof Error ? err.message : "Failed to load pending consignment");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (): Promise<void> => {
    try {
      setHistoryLoading(true);

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
          rejection_reason,
          approved_at
        `)
        .in("approval_status", ["approved", "rejected"])
        .order("approved_at", { ascending: false });

      if (error) throw error;

      setHistoryItems((data ?? []) as ConsignmentRow[]);
    } catch (err: unknown) {
      console.error("loadHistory error:", err);
      setToastMessage(err instanceof Error ? err.message : "Failed to load consignment records");
      setShowToast(true);
    } finally {
      setHistoryLoading(false);
    }
  };

  const reloadAll = async (): Promise<void> => {
    await Promise.all([loadPending(), loadHistory()]);
  };

  useEffect(() => {
    void reloadAll();
  }, []);

  const handleApprove = async (id: string): Promise<void> => {
    try {
      const { error } = await supabase.rpc("approve_consignment", {
        p_consignment_id: id,
      });

      if (error) {
        console.error("approve_consignment rpc error:", error);
        throw new Error(error.message);
      }

      setToastMessage("Consignment approved!");
      setShowToast(true);
      await reloadAll();
    } catch (err: unknown) {
      console.error("handleApprove error:", err);
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

      if (error) {
        console.error("reject_consignment rpc error:", error);
        throw new Error(error.message);
      }

      setToastMessage("Consignment rejected!");
      setShowToast(true);
      await reloadAll();
    } catch (err: unknown) {
      console.error("handleReject error:", err);
      setToastMessage(err instanceof Error ? err.message : "Reject failed");
      setShowToast(true);
    }
  };

  const filteredHistory = useMemo(() => {
    if (historyFilter === "approved") {
      return historyItems.filter((item) => item.approval_status === "approved");
    }
    if (historyFilter === "rejected") {
      return historyItems.filter((item) => item.approval_status === "rejected");
    }
    return historyItems;
  }, [historyItems, historyFilter]);

  return (
    <IonPage className="aca-page">
      <IonHeader className="aca-header"></IonHeader>

      <IonContent className="aca-content">
        <div className="aca-shell">
          <div className="aca-head">
            <h1 className="aca-title">Consignment Approval</h1>
            <p className="aca-subtitle">Review and approve pending consignment items.</p>
          </div>

          <div className="aca-section">
            <div className="aca-section-head">
              <h2 className="aca-section-title">Pending Items</h2>

              <IonButton className="aca-btn aca-btn-approve" onClick={() => void reloadAll()}>
                Refresh
              </IonButton>
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
                            onClick={() => void handleApprove(item.id)}
                          >
                            Approve
                          </IonButton>

                          <IonButton
                            className="aca-btn aca-btn-reject"
                            fill="outline"
                            onClick={() => void handleReject(item.id)}
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

          <div className="aca-section aca-history-section">
            <div className="aca-section-head aca-section-head--history">
              <h2 className="aca-section-title">Approval Records</h2>
            </div>

            <div className="aca-history-toolbar">
              <IonSegment
                value={historyFilter}
                className="aca-segment"
                onIonChange={(e) => setHistoryFilter((e.detail.value as HistoryFilter) ?? "all")}
              >
                <IonSegmentButton value="all">
                  <IonLabel>All</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="approved">
                  <IonLabel>Approved</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="rejected">
                  <IonLabel>Rejected</IonLabel>
                </IonSegmentButton>
              </IonSegment>

              <IonButton className="aca-btn aca-btn-approve" onClick={() => void loadHistory()}>
                Refresh Records
              </IonButton>
            </div>

            {historyLoading ? (
              <div className="aca-loading">
                <IonSpinner name="crescent" />
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="aca-empty">No approval records found.</div>
            ) : (
              <div className="aca-table-wrap">
                <table className="aca-table">
                  <thead>
                    <tr>
                      <th>Date Submitted</th>
                      <th>Decision Date</th>
                      <th>Full Name</th>
                      <th>Item Name</th>
                      <th>Category</th>
                      <th>Size</th>
                      <th>Price</th>
                      <th>Restocked</th>
                      <th>Status</th>
                      <th>Reject Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.created_at)}</td>
                        <td>{formatDateTime(item.approved_at)}</td>
                        <td>{item.full_name}</td>
                        <td>{item.item_name}</td>
                        <td>{item.category ?? "-"}</td>
                        <td>{item.size ?? "-"}</td>
                        <td>₱{Number(item.price).toFixed(2)}</td>
                        <td>{item.restocked}</td>
                        <td>
                          <span
                            className={`aca-badge ${
                              item.approval_status === "approved"
                                ? "aca-badge-approved"
                                : "aca-badge-rejected"
                            }`}
                          >
                            {item.approval_status}
                          </span>
                        </td>
                        <td>{item.rejection_reason?.trim() ? item.rejection_reason : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <IonToast
          isOpen={showToast}
          message={toastMessage}
          duration={3000}
          onDidDismiss={() => setShowToast(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Admin_Consignment_Approval;