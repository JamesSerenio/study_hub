import {
  IonModal,
  IonButton,
} from "@ionic/react";
import { useEffect, useRef } from "react";

interface Props {
  isOpen: boolean;
  message: string;
  onClose: () => void;
}

const TimeAlertModal: React.FC<Props> = ({
  isOpen,
  message,
  onClose,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isOpen && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.loop = true;
      audioRef.current.play().catch(() => {});
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [isOpen]);

  return (
<IonModal
  isOpen={isOpen}
  backdropDismiss={false}
  className="time-alert-modal"
>
  <div className="time-alert-wrapper">

    <audio ref={audioRef} src="/assets/alarm.mp3" />

    <div
      className="alert-box"
      dangerouslySetInnerHTML={{ __html: message }}
    />

    <IonButton
      expand="block"
      color="danger"
      className="alert-btn"
      onClick={onClose}
    >
      STOP ALARM
    </IonButton>

  </div>
</IonModal>

  );
};

export default TimeAlertModal;