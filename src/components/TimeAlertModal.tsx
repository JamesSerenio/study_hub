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
  category: string;
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
  if (k === "consignment") return "CONSIGNMENT ORDER";
  return "ADD-ONS ORDER";
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

  const isStaff = (role ?? "").toLowerCase() === "staff";
  const totalAlerts = alerts.length + orderAlerts.length;
  const canOpen = isStaff && isOpen && totalAlerts > 0;

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

  if (!isStaff) return null;

  return (
    <IonModal isOpen={canOpen} backdropDismiss={false} className="time-alert-modal">
      <div
        className="time-alert-wrapper"
        style={{
          minHeight: "100%",
          background: "#f6fbf6",
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
            maxWidth: 520,
            background: "#ffffff",
            borderRadius: 18,
            padding: 16,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            border: "2px solid #6a8f4e",
          }}
        >
          <div
            style={{
              fontWeight: 900,
              marginBottom: 12,
              color: "#2f5d34",
              fontSize: 20,
              textAlign: "center",
            }}
          >
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
                }}
              >
                <div
                  style={{
                    fontWeight: 900,
                    marginBottom: 8,
                    color: "#2f5d34",
                    fontSize: 17,
                  }}
                >
                  🛒 NEW ORDER ALERT
                </div>

                <div style={{ color: "#1f3522", lineHeight: 1.6 }}>
                  <strong>Type:</strong> {orderKindLabel(o.kind)} <br />
                  <strong>Customer:</strong> {o.full_name} <br />
                  <strong>Seat:</strong> {o.seat_number || "-"}
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {o.lines.map((line, index) => (
                    <div
                      key={`${o.key}-line-${index}`}
                      style={{
                        background: "#f6fbf6",
                        borderRadius: 10,
                        padding: 10,
                        border: "1px solid #cfe4cf",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 800,
                          color: "#2f5d34",
                          marginBottom: 4,
                        }}
                      >
                        {line.quantity}x {line.name}
                      </div>

                      <div
                        style={{
                          fontSize: 13,
                          color: "#335c38",
                          lineHeight: 1.5,
                        }}
                      >
                        <strong>Size:</strong> {line.size || "-"} <br />
                        <strong>Category:</strong> {line.category || "-"}
                      </div>
                    </div>
                  ))}
                </div>

                <IonButton
                  expand="block"
                  className="alert-btn"
                  style={{
                    marginTop: 10,
                    "--background": "#6a8f4e",
                    "--background-hover": "#5b7c43",
                    "--background-activated": "#5b7c43",
                    "--color": "#ffffff",
                    "--border-radius": "10px",
                    fontWeight: 700,
                  } as React.CSSProperties}
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
                  background: "#ffffff",
                  borderRadius: 14,
                  padding: 12,
                  border: "2px solid #6a8f4e",
                }}
              >
                <div
                  style={{
                    fontWeight: 900,
                    marginBottom: 8,
                    color: "#2f5d34",
                    fontSize: 17,
                  }}
                >
                  ⏰ {a.minutes_left} MINUTE(S) LEFT
                </div>

                <div style={{ color: "#1f3522", lineHeight: 1.6 }}>
                  <strong>Type:</strong> {kindLabel(a.kind)} <br />
                  <strong>Customer:</strong> {a.full_name} <br />
                  <strong>Seat:</strong> {a.seat_number || "-"}
                </div>

                <IonButton
                  expand="block"
                  className="alert-btn"
                  style={{
                    marginTop: 10,
                    "--background": "#6a8f4e",
                    "--background-hover": "#5b7c43",
                    "--background-activated": "#5b7c43",
                    "--color": "#ffffff",
                    "--border-radius": "10px",
                    fontWeight: 700,
                  } as React.CSSProperties}
                  onClick={() => onStopOne(a.key)}
                >
                  STOP THIS ALERT
                </IonButton>
              </div>
            ))}
          </div>

          <IonButton
            expand="block"
            fill="outline"
            style={{
              marginTop: 12,
              "--color": "#2f5d34",
              "--border-color": "#6a8f4e",
              "--border-radius": "10px",
              fontWeight: 700,
            } as React.CSSProperties}
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