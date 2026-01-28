import { IonModal, IonButton } from "@ionic/react";
import { useEffect, useRef } from "react";

interface Props {
  isOpen: boolean;
  message: string;
  onClose: () => void;

  /** ✅ pass exact role string (ex: "staff" | "admin" | "customer") */
  role: string | null | undefined;
}

const TimeAlertModal: React.FC<Props> = ({ isOpen, message, onClose, role }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isStaff = (role ?? "").toLowerCase() === "staff";
  const canOpen = isStaff && isOpen;

  useEffect(() => {
    // ✅ if not staff or closed -> stop sound
    if (!canOpen) {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
      return;
    }

    const a = audioRef.current;
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

  // ✅ HARD GUARD: Admin (or others) will NEVER see this modal
  if (!isStaff) return null;

  return (
    <IonModal isOpen={canOpen} backdropDismiss={false} className="time-alert-modal">
      <div className="time-alert-wrapper">
        <audio ref={audioRef} src="/assets/alarm.mp3" />

        <div className="alert-box" dangerouslySetInnerHTML={{ __html: message }} />

        <IonButton expand="block" color="danger" className="alert-btn" onClick={onClose}>
          STOP ALARM
        </IonButton>
      </div>
    </IonModal>
  );
};

export default TimeAlertModal;
