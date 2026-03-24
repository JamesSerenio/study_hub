import React, { useEffect, useRef } from "react";
import { IonModal, IonButton } from "@ionic/react";

type AlertKind = "walkin" | "reservation" | "promo";

type AlertItem = {
  key: string;
  kind: AlertKind;
  id: string;
  full_name: string;
  seat_number: string;
  minutes_left: number;
  end_iso: string;
};

type OrderAlertKind = "add_ons" | "consignment";

type OrderAlertLine = {
  name: string;
  quantity: number;
  size: string;
  image_url?: string | null;
};

type OrderAlertItem = {
  key: string;
  kind: OrderAlertKind;
  id: string;
  full_name: string;
  seat_number: string;
  created_at: string;
  lines: OrderAlertLine[];
};

const kindLabel = (k: AlertKind): string => {
  if (k === "walkin") return "WALK-IN";
  if (k === "reservation") return "RESERVATION";
  return "PROMO / MEMBERSHIP";
};

const orderKindLabel = (k: OrderAlertKind): string => {
  if (k === "consignment") return "OTHER ITEMS";
  return "ORDER";
};

interface Props {
  isOpen: boolean;
  role: string | null | undefined;
  alerts: AlertItem[];
  orderAlerts?: OrderAlertItem[];
  onStopOne: (key: string) => void;
  onClose: () => void;
}

const TimeAlertModal: React.FC<Props> = ({
  isOpen,
  role,
  alerts,
  orderAlerts = [],
  onStopOne,
  onClose,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const normalizedRole = (role ?? "").toLowerCase();
  const isStaffOrAdmin =
    normalizedRole === "staff" || normalizedRole === "admin";

  const totalAlerts = alerts.length + orderAlerts.length;
  const canOpen = isStaffOrAdmin && isOpen && totalAlerts > 0;

  useEffect(() => {
    const a = audioRef.current;

    if (!canOpen) {
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
      return;
    }

    if (a) {
      a.currentTime = 0;
      a.loop = true;
      a.play().catch(() => {});
    }

    return () => {
      const a2 = audioRef.current;
      if (a2) {
        a2.pause();
        a2.currentTime = 0;
      }
    };
  }, [canOpen]);

  if (!isStaffOrAdmin) return null;

  return (
    <IonModal
      isOpen={canOpen}
      backdropDismiss={false}
      className="time-alert-modal"
    >
      <div
        className="time-alert-wrapper"
        style={{
          minHeight: "100%",
          background: "rgba(0, 0, 0, 0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <audio ref={audioRef} src="/assets/alarm.mp3" />

        <div
          className="alert-box"
          style={{
            width: "100%",
            maxWidth: 430,
            maxHeight: "85vh",
            overflowY: "auto",
            background: "#efe4ba",
            border: "3px solid red",
            borderRadius: 18,
            padding: 14,
            boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            🚨 {totalAlerts} ALERT(S)
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {orderAlerts.map((o) => (
              <div
                key={o.key}
                style={{
                  background: "#ffffff",
                  borderRadius: 14,
                  padding: 12,
                  border: "2px solid #6a8f4e",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              >
                <div
                  style={{
                    fontWeight: 900,
                    marginBottom: 8,
                    color: "#2f5d34",
                    fontSize: 16,
                  }}
                >
                  🛒 NEW {orderKindLabel(o.kind)} ALERT
                </div>

                <div
                  style={{
                    color: "#1f3522",
                    lineHeight: 1.6,
                    marginBottom: 10,
                    fontSize: 14,
                  }}
                >
                  <strong>Customer:</strong> {o.full_name} <br />
                  <strong>Seat:</strong> {o.seat_number || "-"}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {o.lines.map((line, index) => (
                    <div
                      key={`${o.key}-line-${index}`}
                      style={{
                        background: "#f6fbf6",
                        borderRadius: 10,
                        padding: 10,
                        border: "1px solid #cfe4cf",
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      {line.image_url ? (
                        <img
                          src={line.image_url}
                          alt={line.name}
                          style={{
                            width: 70,
                            height: 70,
                            objectFit: "cover",
                            borderRadius: 10,
                            flexShrink: 0,
                            border: "1px solid #cfe4cf",
                            background: "#fff",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 70,
                            height: 70,
                            borderRadius: 10,
                            flexShrink: 0,
                            border: "1px solid #cfe4cf",
                            background: "#fff",
                            color: "#7a927c",
                            fontSize: 11,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            padding: 4,
                            fontWeight: 700,
                          }}
                        >
                          NO IMAGE
                        </div>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 800,
                            color: "#2f5d34",
                            marginBottom: 4,
                            fontSize: 16,
                            wordBreak: "break-word",
                          }}
                        >
                          {line.name}
                        </div>

                        <div
                          style={{
                            fontSize: 14,
                            color: "#335c38",
                            lineHeight: 1.5,
                            wordBreak: "break-word",
                          }}
                        >
                          <strong>Quantity:</strong> {line.quantity} <br />
                          <strong>Size:</strong> {line.size || "-"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <IonButton
                  expand="block"
                  className="alert-btn"
                  style={
                    {
                      marginTop: 10,
                      "--background": "#769954",
                      "--background-hover": "#6b8b4c",
                      "--background-activated": "#6b8b4c",
                      "--color": "#ffffff",
                      "--border-radius": "10px",
                      fontWeight: 700,
                    } as React.CSSProperties
                  }
                  onClick={() => onStopOne(o.key)}
                >
                  STOP ORDER ALERT
                </IonButton>
              </div>
            ))}

            {alerts.map((a) => (
              <div
                key={a.key}
                style={{
                  background: "#fff",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  ⏰ {a.minutes_left} MINUTE(S) LEFT
                </div>

                <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                  <strong>Type:</strong> {kindLabel(a.kind)} <br />
                  <strong>Customer:</strong> {a.full_name} <br />
                  <strong>Seat:</strong> {a.seat_number || "-"}
                </div>

                <IonButton
                  expand="block"
                  color="danger"
                  className="alert-btn"
                  style={{ marginTop: 8 }}
                  onClick={() => onStopOne(a.key)}
                >
                  STOP THIS ALERT
                </IonButton>
              </div>
            ))}
          </div>

          <IonButton
            expand="block"
            fill="clear"
            style={{ marginTop: 10 }}
            onClick={onClose}
          >
            Close (keep alerts)
          </IonButton>
        </div>
      </div>
    </IonModal>
  );
};

export default TimeAlertModal;