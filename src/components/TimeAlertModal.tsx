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

const kindLabel = (k: AlertKind): string => {
  if (k === "walkin") return "WALK-IN";
  if (k === "reservation") return "RESERVATION";
  return "PROMO / MEMBERSHIP";
};

interface Props {
  isOpen: boolean;
  role: string | null | undefined;
  alerts: AlertItem[];
  onStopOne: (key: string) => void;
  onClose: () => void;
}

const TimeAlertModal: React.FC<Props> = ({ isOpen, role, alerts, onStopOne, onClose }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isStaff = (role ?? "").toLowerCase() === "staff";
  const canOpen = isStaff && isOpen && alerts.length > 0;

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
      <div className="time-alert-wrapper">
        <audio ref={audioRef} src="/assets/alarm.mp3" />

        <div className="alert-box">
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            🚨 {alerts.length} ALERT(S)
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {alerts.map((a) => (
              <div key={a.key} style={{ background: "#fff", borderRadius: 10, padding: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  ⏰ {a.minutes_left} MINUTE(S) LEFT
                </div>
                <div>
                  <strong>Type:</strong> {kindLabel(a.kind)} <br />
                  <strong>Customer:</strong> {a.full_name} <br />
                  <strong>Seat:</strong> {a.seat_number || "-"}
                </div>

                <IonButton expand="block" color="danger" className="alert-btn" style={{ marginTop: 8 }} onClick={() => onStopOne(a.key)}>
                  STOP THIS ALERT
                </IonButton>
              </div>
            ))}
          </div>

          {/* optional: just close UI, not clearing alerts */}
          <IonButton expand="block" fill="clear" style={{ marginTop: 8 }} onClick={onClose}>
            Close (keep alerts)
          </IonButton>
        </div>
      </div>
    </IonModal>
  );
};

export default TimeAlertModal;
